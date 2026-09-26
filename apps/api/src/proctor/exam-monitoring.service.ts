import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthUsersRepository } from '../auth/auth-users.repository';
import { AuthorizationService } from '../auth/authorization.service';
import { chunk } from '../common/chunk';
import { loadExamQuestions } from '../common/exam-question-sources';
import { GradingService } from '../grading/grading.service';
import { DbService } from '../prisma/prisma-db-adapter';
import { ScoringClient } from '../scoring/scoring.client';

/** Batas id per klausa `IN (...)`, supaya pernyataan SQL tidak membengkak. */
const ID_BATCH = 300;

/** Peristiwa administratif — bukan pelanggaran, tidak ikut dihitung. */
const NON_VIOLATION_EVENTS = ['RESET_BY_PROCTOR', 'FORCE_TERMINATED'];

/** Peristiwa yang dianggap "pindah tab" pada rincian pelanggaran. */
const TAB_SWITCH_EVENTS = ['tab_switch', 'window_blur', 'blur'];

/**
 * Toleransi sebelum pengerjaan yang lewat tenggat ditutup otomatis.
 *
 * Jeda satu menit ini menghindari menutup pengerjaan siswa yang jamnya baru saja
 * habis sementara permintaan submit-nya masih dalam perjalanan.
 */
const AUTO_FINISH_GRACE_MS = 60 * 1000;

const DEFAULT_DURATION_MINUTES = 60;

/**
 * Pemantauan ujian dan hasilnya untuk staf: daftar pengerjaan, analisis butir,
 * rincian satu pengerjaan, dan penilaian tugas.
 *
 * Dipindahkan dari `apps/web/app/actions/proktor.ts`.
 *
 * Yang HILANG di sini dan itu memang disengaja: `fetchAllRows`. Helper itu ada
 * untuk melewati cap 1000 baris PostgREST — sebuah `.select()` yang cocok dengan
 * lebih dari 1000 baris dipotong diam-diam, tanpa galat, sehingga analisis butir
 * pada ujian besar salah hitung. Adapter NestJS berbicara langsung ke PostgreSQL
 * lewat SQL mentah; tidak ada cap semacam itu, dan `LIMIT` hanya muncul kalau
 * kita yang meminta.
 */
@Injectable()
export class ExamMonitoringService {
    private readonly logger = new Logger(ExamMonitoringService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
        private readonly scoring: ScoringClient,
        private readonly grading: GradingService,
        private readonly authUsers: AuthUsersRepository,
    ) {}

    /**
     * Daftar pengerjaan sebuah ujian, ditambah siswa yang BELUM memulai.
     *
     * Siswa yang belum mulai ikut ditampilkan sebagai baris berstatus `belum` —
     * tanpa itu, layar pemantauan hanya memperlihatkan yang sudah masuk dan
     * pengawas tidak bisa melihat siapa yang tertinggal.
     */
    async listAttempts(user: AuthUser, examId: string) {
        await this.authz.assertExamMonitoring(user, examId);

        // Pengerjaan yang tenggatnya lewat ditutup lebih dulu, supaya status
        // "sedang mengerjakan" di layar benar-benar berarti sedang mengerjakan.
        await this.finalizeExpired(examId);

        const { data, error } = await this.db
            .from('cbt_exam_attempts')
            .select(
                `id, status, total_score, score_irt, irt_theta, needs_manual_grading,
                 started_at, finished_at, tab_switch_count, warning_count, exam_id, user_id,
                 profiles:cbt_profiles(full_name)`,
            )
            .eq('exam_id', examId)
            .order('started_at', { ascending: false });

        if (error) {
            this.logger.error(`Gagal membaca pengerjaan ujian ${examId}: ${error.message}`);
            return [];
        }

        const attempts = (data as any[]) || [];
        const attemptIds = attempts.map((a) => a.id);
        const attemptUserIds = new Set(attempts.map((a) => a.user_id).filter(Boolean));

        const [assigned, logs] = await Promise.all([
            this.loadAssignedStudents(examId),
            this.loadSecurityLogs(attemptIds),
        ]);

        // Siswa yang punya pengerjaan tetapi kelasnya tidak termasuk sasaran
        // ujian — mis. peserta perorangan — tetap perlu nama kelasnya.
        const unmapped = [...attemptUserIds].filter((id) => !assigned.classByUser.has(id));
        if (unmapped.length > 0) {
            for (const ids of chunk(unmapped, ID_BATCH)) {
                const { data: memberships } = await this.db
                    .from('cbt_class_members')
                    .select('user_id, class_id, classes:cbt_classes(name)')
                    .in('user_id', ids);

                for (const row of (memberships as any[]) || []) {
                    appendClassName(assigned.classByUser, row);
                }
            }
        }

        const rows = attempts.map((attempt) => ({
            ...attempt,
            kelas_name: assigned.classByUser.get(attempt.user_id) || '-',
            violation_breakdown: summariseViolations(logs.get(attempt.id) || []),
        }));

        for (const [userId, profile] of assigned.profileByUser) {
            if (attemptUserIds.has(userId)) continue;

            rows.push({
                id: `unstarted-${userId}`,
                status: 'belum',
                total_score: 0,
                score_irt: null,
                irt_theta: null,
                needs_manual_grading: false,
                started_at: null,
                finished_at: null,
                tab_switch_count: 0,
                warning_count: 0,
                exam_id: examId,
                user_id: userId,
                profiles: profile,
                kelas_name: assigned.classByUser.get(userId) || '-',
                violation_breakdown: { pindah_tab: 0, close_tab: 0, lainnya: 0 },
            });
        }

        return rows;
    }

    /** Siswa di kelas-kelas yang ditugasi ujian ini, beserta nama kelasnya. */
    private async loadAssignedStudents(examId: string) {
        const classByUser = new Map<string, string>();
        const profileByUser = new Map<string, any>();

        const { data: targets } = await this.db
            .from('cbt_exam_targets')
            .select('class_id')
            .eq('exam_id', examId);

        const classIds = [
            ...new Set(
                ((targets as Array<{ class_id: string | null }>) || [])
                    .map((t) => t.class_id)
                    .filter((id): id is string => Boolean(id)),
            ),
        ];

        for (const ids of chunk(classIds, 100)) {
            const { data } = await this.db
                .from('cbt_class_members')
                .select(
                    'user_id, class_id, profiles:cbt_profiles(full_name), classes:cbt_classes(name)',
                )
                .in('class_id', ids);

            for (const row of (data as any[]) || []) {
                appendClassName(classByUser, row);

                if (!profileByUser.has(row.user_id)) {
                    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
                    profileByUser.set(row.user_id, profile ?? null);
                }
            }
        }

        return { classByUser, profileByUser };
    }

    private async loadSecurityLogs(attemptIds: string[]) {
        const byAttempt = new Map<string, Array<{ event_type: string; created_at: string }>>();
        if (attemptIds.length === 0) return byAttempt;

        for (const ids of chunk(attemptIds, ID_BATCH)) {
            const { data } = await this.db
                .from('cbt_attempt_security_logs')
                .select('attempt_id, event_type, created_at')
                .in('attempt_id', ids)
                .order('created_at', { ascending: true });

            for (const log of (data as any[]) || []) {
                (byAttempt.get(log.attempt_id) ??
                    byAttempt.set(log.attempt_id, []).get(log.attempt_id)!)
                    .push(log);
            }
        }

        return byAttempt;
    }

    /**
     * Tutup pengerjaan yang tenggatnya sudah lewat, dan nilai dari jawaban
     * tersimpan.
     *
     * Tenggat pribadi diambil dari `personal_end_time`; baris lama yang kosong
     * disusun ulang dari `started_at` + durasi. Penutupan jendela ujian selalu
     * menjadi batas atasnya.
     */
    private async finalizeExpired(examId: string): Promise<void> {
        const { data: examRow } = await this.db
            .from('cbt_exams')
            .select('end_time, duration_minutes')
            .eq('id', examId)
            .maybeSingle();

        const { data: openRows } = await this.db
            .from('cbt_exam_attempts')
            .select('id, started_at, personal_end_time')
            .eq('exam_id', examId)
            .eq('status', 'in_progress');

        const open = (openRows as any[]) || [];
        if (open.length === 0) return;

        const exam = examRow as { end_time: string | null; duration_minutes: number | null } | null;
        const windowClose = exam?.end_time ? new Date(exam.end_time).getTime() : null;
        const now = Date.now();

        for (const attempt of open) {
            let deadline: number | null = attempt.personal_end_time
                ? new Date(attempt.personal_end_time).getTime()
                : null;

            if (deadline === null && attempt.started_at) {
                deadline =
                    new Date(attempt.started_at).getTime() +
                    (exam?.duration_minutes || DEFAULT_DURATION_MINUTES) * 60 * 1000;
            }

            if (windowClose !== null && (deadline === null || windowClose < deadline)) {
                deadline = windowClose;
            }

            if (deadline === null || deadline + AUTO_FINISH_GRACE_MS > now) continue;

            try {
                const graded = await this.grading.gradeAttemptFromSavedAnswers(attempt.id);

                await this.db
                    .from('cbt_exam_attempts')
                    .update({
                        status: 'auto_submitted',
                        needs_manual_grading: graded?.hasEssay ?? false,
                        finished_at: new Date().toISOString(),
                        total_score: graded?.finalScore100 ?? 0,
                    })
                    .eq('id', attempt.id)
                    // Jangan timpa siswa yang submit tepat bersamaan.
                    .eq('status', 'in_progress');
            } catch (err) {
                this.logger.error(
                    `Gagal menutup pengerjaan ${attempt.id}: ${(err as Error).message}`,
                );
            }
        }
    }

    /**
     * Pelanggaran terbaru sebuah ujian, untuk umpan "Pelanggaran Terbaru" di
     * layar pemantauan.
     *
     * Dibaca dari LOG di basis data, bukan dari siaran realtime. Versi lama
     * punya fungsi serupa tetapi tanpa satu pun pemanggil, sehingga umpan itu
     * hanya terisi oleh siaran Supabase — dan kosong sama sekali setelah halaman
     * dimuat ulang. Sejak Supabase tidak ada, umpannya tidak pernah terisi lagi.
     */
    async listRecentViolations(user: AuthUser, examId: string, limit: number) {
        await this.authz.assertExamMonitoring(user, examId);

        const { data: attemptRows } = await this.db
            .from('cbt_exam_attempts')
            .select('id, warning_count, profiles:cbt_profiles(full_name)')
            .eq('exam_id', examId);

        const attempts = (attemptRows as any[]) || [];
        if (attempts.length === 0) return [];

        const byId = new Map(attempts.map((a) => [a.id, a]));

        const { data: logs } = await this.db
            .from('cbt_attempt_security_logs')
            .select('attempt_id, event_type, created_at, metadata')
            .in(
                'attempt_id',
                attempts.map((a) => a.id),
            )
            .not('event_type', 'in', `(${NON_VIOLATION_EVENTS.map((e) => `"${e}"`).join(',')})`)
            .order('created_at', { ascending: false })
            .limit(limit);

        return ((logs as any[]) || []).map((log) => {
            const attempt = byId.get(log.attempt_id);
            // Relasi satu-ke-satu bisa terbaca sebagai objek atau array satu
            // elemen, tergantung bagaimana foreign key-nya terdaftar.
            const profile = Array.isArray(attempt?.profiles)
                ? attempt?.profiles[0]
                : attempt?.profiles;

            const seconds = log.metadata?.duration_seconds;

            return {
                // Satu baris per PERISTIWA, bukan per pengerjaan.
                id: `${log.attempt_id}:${log.created_at}`,
                attemptId: log.attempt_id,
                studentName: profile?.full_name || 'Tanpa nama',
                violationType: log.event_type,
                violationCount: attempt?.warning_count ?? 0,
                timestamp: log.created_at,
                duration:
                    typeof seconds === 'number'
                        ? seconds >= 60
                            ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
                            : `${seconds}s`
                        : undefined,
            };
        });
    }

    /**
     * Data analisis butir: SELURUH soal bank beserta kunci jawabannya, ditambah
     * jawaban peserta.
     *
     * Jawaban yang `is_correct`-nya masih null — pengerjaan yang belum
     * dikumpulkan — dinilai saat itu juga lewat FastAPI. Tanpa itu, analisis
     * butir menghitung SEMUA jawaban peserta yang sedang mengerjakan sebagai
     * salah, dan angkanya menyesatkan justru saat ujian sedang berlangsung.
     */
    async getItemAnalysis(user: AuthUser, examId: string) {
        await this.authz.assertExamStaff(user, examId);

        const { data: examRow } = await this.db
            .from('cbt_exams')
            .select('question_bank_id')
            .eq('id', examId)
            .maybeSingle();

        const bankId = (examRow as { question_bank_id: string | null } | null)?.question_bank_id;
        const sorted = await loadExamQuestions(
            this.db,
            examId,
            `id, question_text, type, score_default, metadata, dimension_id, created_at,
             bank_question_options:cbt_bank_question_options(id, option_text, is_correct, weight, order, metadata)`,
            bankId,
        );
        if (sorted.length === 0) return { questions: [], answers: [] };

        const questionById = new Map(sorted.map((q) => [q.id, q]));

        const questions = sorted.map((question, index) => ({
            id: question.id,
            number: index + 1,
            question_text: question.question_text,
            type: question.type,
            options: [...(question.bank_question_options || [])]
                .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
                .map((option: any) => ({
                    id: option.id,
                    option_text: option.option_text,
                    is_correct: option.is_correct === true,
                })),
        }));

        const { data: attemptRows } = await this.db
            .from('cbt_exam_attempts')
            .select('id')
            .eq('exam_id', examId);

        const attemptIds = ((attemptRows as Array<{ id: string }>) || []).map((a) => a.id);
        if (attemptIds.length === 0) return { questions, answers: [] };

        const raw: any[] = [];
        for (const ids of chunk(attemptIds, ID_BATCH)) {
            const { data } = await this.db
                .from('cbt_answers')
                .select('attempt_id, question_id, is_correct, selected_option_id, essay_answer')
                .in('attempt_id', ids);

            raw.push(...((data as any[]) || []));
        }

        const answers = await this.resolveCorrectness(raw, questionById);
        return { questions, answers };
    }

    /**
     * Lengkapi `is_correct` yang masih kosong dengan menilai jawabannya sekarang.
     *
     * Seluruh jawaban yang belum dinilai dikirim ke FastAPI dalam SATU
     * permintaan, bukan satu per satu: ujian besar bisa punya puluhan ribu
     * jawaban yang belum dikumpulkan.
     */
    private async resolveCorrectness(
        rows: any[],
        questionById: Map<string, any>,
    ): Promise<Array<{ attempt_id: string; question_id: string; is_correct: boolean | null }>> {
        const settled: Array<{
            attempt_id: string;
            question_id: string;
            is_correct: boolean | null;
        }> = [];

        const pending: Array<{ row: any; key: string }> = [];
        const items: Array<{ question: any; answer_id: string; raw_answer: string }> = [];

        for (const row of rows) {
            const rawAnswer = row.essay_answer ?? row.selected_option_id;

            if (row.is_correct !== null && row.is_correct !== undefined) {
                settled.push({
                    attempt_id: row.attempt_id,
                    question_id: row.question_id,
                    is_correct: row.is_correct,
                });
                continue;
            }

            // Baris tanpa isi jawaban sama sekali — mis. hanya ditandai ragu —
            // bukan "menjawab", jadi ia tidak ikut dihitung.
            if (!rawAnswer) continue;

            const question = questionById.get(row.question_id);
            if (!question) continue;

            const key = `${row.attempt_id}:${row.question_id}`;
            pending.push({ row, key });
            items.push({ question, answer_id: key, raw_answer: rawAnswer });
        }

        if (items.length === 0) return settled;

        try {
            const result = await this.scoring.post<{
                items: Array<{ answer_id: string | null; is_correct: boolean | null }>;
            }>('/grading/attempt', { items });

            const byKey = new Map(result.items.map((item) => [item.answer_id, item.is_correct]));

            for (const { row, key } of pending) {
                settled.push({
                    attempt_id: row.attempt_id,
                    question_id: row.question_id,
                    is_correct: byKey.get(key) ?? null,
                });
            }
        } catch (err) {
            // Analisis tetap ditampilkan dari jawaban yang sudah dinilai; yang
            // belum dinilai dihilangkan, bukan dihitung sebagai salah.
            this.logger.error(
                `Penilaian jawaban berjalan gagal, analisis memakai data tersimpan saja: ${(err as Error).message}`,
            );
        }

        return settled;
    }

    /**
     * Rincian lengkap satu pengerjaan: jawaban, soal, dan log keamanannya.
     *
     * Untuk pengerjaan yang MASIH berlangsung, skor dihitung saat itu juga —
     * `cbt_answers` belum punya nilai sampai ujian dikumpulkan, jadi tanpa ini
     * layar pengawas selalu menampilkan nol.
     */
    async getAttemptDetails(user: AuthUser, attemptId: string) {
        const { data } = await this.db
            .from('cbt_exam_attempts')
            .select('*, profiles:cbt_profiles(full_name), exams:cbt_exams(*)')
            .eq('id', attemptId)
            .maybeSingle();

        if (!data) throw new NotFoundException('Pengerjaan tidak ditemukan.');

        const attempt = data as any;
        await this.authz.assertExamMonitoring(user, attempt.exam_id);

        const [{ data: answerRows }, { data: securityLogs }] = await Promise.all([
            this.db
                .from('cbt_answers')
                .select(
                    `*, bank_questions:cbt_bank_questions(
                        *, bank_question_options:cbt_bank_question_options(*)
                     )`,
                )
                .eq('attempt_id', attemptId),
            this.db
                .from('cbt_attempt_security_logs')
                .select('*')
                .eq('attempt_id', attemptId)
                .order('created_at', { ascending: true }),
        ]);

        const answers = (answerRows as any[]) || [];

        if (attempt.status === 'in_progress') {
            await this.applyLiveScores(attempt, answers);
        }

        const account = await this.authUsers.findById(attempt.user_id);

        return {
            attempt: { ...attempt, email: account?.email || '-' },
            answers: answers.sort(
                (a, b) =>
                    (a.bank_questions?.order_number ?? Number.MAX_SAFE_INTEGER) -
                    (b.bank_questions?.order_number ?? Number.MAX_SAFE_INTEGER),
            ),
            securityLogs: (securityLogs as any[]) || [],
        };
    }

    /** Nilai sementara untuk pengerjaan yang masih berlangsung. */
    private async applyLiveScores(attempt: any, answers: any[]): Promise<void> {
        const items = answers
            .filter((answer) => answer.bank_questions && answer.is_correct === null)
            .map((answer) => ({
                question: answer.bank_questions,
                answer_id: answer.id,
                raw_answer: answer.essay_answer ?? answer.selected_option_id,
            }))
            .filter((item) => item.raw_answer);

        let maxPossible = 0;
        let total = 0;

        for (const answer of answers) {
            if (!answer.bank_questions) continue;
            maxPossible += answer.bank_questions.score_default || 1;
            if (answer.is_correct !== null) total += answer.score || 0;
        }

        if (items.length > 0) {
            try {
                const result = await this.scoring.post<{
                    items: Array<{
                        answer_id: string | null;
                        score: number;
                        is_correct: boolean | null;
                    }>;
                }>('/grading/attempt', { items });

                const byId = new Map(result.items.map((item) => [item.answer_id, item]));

                for (const answer of answers) {
                    const scored = byId.get(answer.id);
                    if (!scored) continue;

                    // Hanya disalin ke objek yang dikirim ke layar; `cbt_answers`
                    // tidak ditulis — penilaian permanen tetap terjadi saat submit.
                    answer.score = scored.score;
                    answer.is_correct = scored.is_correct;
                    total += scored.score;
                }
            } catch (err) {
                this.logger.error(
                    `Nilai sementara gagal dihitung untuk pengerjaan ${attempt.id}: ${(err as Error).message}`,
                );
            }
        }

        attempt.total_score = maxPossible > 0 ? (total / maxPossible) * 100 : 0;
    }

    // ── Tugas (assignment) ───────────────────────────────────────────────────

    /**
     * Seluruh peserta sebuah tugas beserta status pengumpulannya.
     *
     * Peserta dikumpulkan dari dua sumber — kelas sasaran dan peserta
     * perorangan — supaya siswa yang belum mengumpulkan tetap muncul.
     */
    async listAssignmentSubmissions(user: AuthUser, examId: string) {
        await this.authz.assertExamStaff(user, examId);

        const [{ data: exam }, { data: targets }, { data: participants }, { data: attempts }] =
            await Promise.all([
                this.db
                    .from('cbt_exams')
                    .select('id, title, metadata, end_time')
                    .eq('id', examId)
                    .maybeSingle(),
                this.db
                    .from('cbt_exam_targets')
                    .select('class_id, classes:cbt_classes(id, name)')
                    .eq('exam_id', examId),
                this.db.from('cbt_exam_participants').select('user_id').eq('exam_id', examId),
                this.db
                    .from('cbt_exam_attempts')
                    .select(
                        'id, user_id, status, total_score, finished_at, needs_manual_grading, metadata',
                    )
                    .eq('exam_id', examId)
                    .order('finished_at', { ascending: false }),
            ]);

        if (!exam) throw new NotFoundException('Ujian tidak ditemukan.');

        const userIds = new Set(
            ((participants as Array<{ user_id: string }>) || []).map((p) => p.user_id),
        );

        const classIds = ((targets as Array<{ class_id: string | null }>) || [])
            .map((t) => t.class_id)
            .filter((id): id is string => Boolean(id));

        if (classIds.length > 0) {
            const { data: members } = await this.db
                .from('cbt_class_members')
                .select('user_id')
                .in('class_id', classIds);

            for (const member of (members as Array<{ user_id: string }>) || []) {
                userIds.add(member.user_id);
            }
        }

        if (userIds.size === 0) {
            return { exam, submissions: [], classes: [] };
        }

        const { data: profiles } = await this.db
            .from('cbt_profiles')
            .select('id, full_name, identity_number')
            .in('id', [...userIds]);

        // Satu siswa bisa punya lebih dari satu pengerjaan; yang sudah selesai
        // didahulukan supaya kartu pengumpulan tidak menampilkan yang telantar.
        const attemptByUser = new Map<string, any>();
        for (const attempt of (attempts as any[]) || []) {
            const current = attemptByUser.get(attempt.user_id);
            if (!current || (attempt.finished_at && !current.finished_at)) {
                attemptByUser.set(attempt.user_id, attempt);
            }
        }

        const submissions = ((profiles as any[]) || []).map((profile) => {
            const attempt = attemptByUser.get(profile.id);
            const submission = attempt?.metadata?.assignment_submission;

            return {
                userId: profile.id,
                fullName: profile.full_name || 'Tanpa nama',
                identityNumber: profile.identity_number || '-',
                attemptId: attempt?.id || null,
                status: !attempt
                    ? 'belum_mulai'
                    : attempt.status === 'in_progress'
                      ? 'sedang_dikerjakan'
                      : 'sudah_kumpul',
                score: attempt?.total_score ?? null,
                submittedAt: attempt?.finished_at || null,
                needsGrading: attempt?.needs_manual_grading ?? false,
                fileUrls: submission?.fileUrls || [],
                textSubmission: submission?.textSubmission || '',
                teacherFeedback: attempt?.metadata?.teacher_feedback || '',
                teacherScore: attempt?.metadata?.teacher_score ?? null,
            };
        });

        return {
            exam,
            submissions,
            classes: ((targets as any[]) || []).map((t) => t.classes).filter(Boolean),
        };
    }

    async gradeAssignment(
        user: AuthUser,
        attemptId: string,
        score: number,
        feedback: string,
    ) {
        const { data } = await this.db
            .from('cbt_exam_attempts')
            .select('exam_id, metadata')
            .eq('id', attemptId)
            .maybeSingle();

        if (!data) throw new NotFoundException('Pengerjaan tidak ditemukan.');

        const attempt = data as { exam_id: string; metadata: Record<string, any> | null };

        // Otorisasi lewat ujian induknya: Guru hanya boleh menilai tugas dari
        // ujian buatannya sendiri.
        await this.authz.assertExamStaff(user, attempt.exam_id);

        const { error } = await this.db
            .from('cbt_exam_attempts')
            .update({
                total_score: score,
                needs_manual_grading: false,
                metadata: {
                    ...(attempt.metadata || {}),
                    teacher_score: score,
                    teacher_feedback: feedback,
                    graded_at: new Date().toISOString(),
                },
            })
            .eq('id', attemptId);

        if (error) throw new BadRequestException(error.message);

        return { attemptId, score };
    }
}

/** Tempelkan nama kelas ke peta, menggabungkan bila siswa ada di banyak kelas. */
function appendClassName(target: Map<string, string>, row: any): void {
    const cls = Array.isArray(row.classes) ? row.classes[0] : row.classes;
    if (!cls?.name) return;

    const existing = target.get(row.user_id);
    if (!existing) target.set(row.user_id, cls.name);
    else if (!existing.includes(cls.name)) target.set(row.user_id, `${existing}, ${cls.name}`);
}

/**
 * Rincian pelanggaran per jenis, dihitung SEJAK reset terakhir oleh proktor.
 *
 * Reset dimaksudkan memberi siswa awal yang bersih, jadi peristiwa sebelumnya
 * tidak ikut dihitung — konsisten dengan `warning_count` di ProctoringService.
 */
function summariseViolations(logs: Array<{ event_type: string; created_at: string }>) {
    const lastReset = logs
        .filter((log) => log.event_type === 'RESET_BY_PROCTOR')
        .map((log) => log.created_at)
        .sort()
        .pop();

    const breakdown = { pindah_tab: 0, close_tab: 0, lainnya: 0 };

    for (const log of logs) {
        if (NON_VIOLATION_EVENTS.includes(log.event_type)) continue;
        if (lastReset && log.created_at <= lastReset) continue;

        if (TAB_SWITCH_EVENTS.includes(log.event_type)) breakdown.pindah_tab++;
        else if (log.event_type === 'tab_close') breakdown.close_tab++;
        else breakdown.lainnya++;
    }

    return breakdown;
}
