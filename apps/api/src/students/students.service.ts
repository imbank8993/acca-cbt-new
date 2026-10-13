import { assertAnswerKeysReleased } from '../common/answer-key-release';
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    HttpException,
    HttpStatus,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { DbService } from '../prisma/prisma-db-adapter';
import { assertExamAccess, canAccessExam, loadExamAudience } from './exam-access';

/** Status attempt yang berarti siswa sudah selesai mengerjakan. */
const FINISHED_STATUSES = ['submitted', 'auto_submitted'];

/**
 * Data siswa atas dirinya sendiri: kelas, jadwal ujian, dan hasil.
 *
 * Dipindahkan dari `apps/web/app/actions/siswa.ts`.
 *
 * Satu perubahan menyeluruh: TIDAK ADA fungsi di sini yang menerima `userId`.
 * Versi lama menerimanya sebagai parameter biasa dari browser pada setiap
 * pemanggilan — `getStudentResultsAction(userId)`,
 * `getAttemptDetailsAction(attemptId, userId)`, `listStudentClasses(userId)` —
 * sehingga daftar kelas, riwayat nilai, dan rincian jawaban siswa lain bisa
 * dibaca hanya dengan menukar UUID. Identitasnya kini selalu dari token.
 */
@Injectable()
export class StudentsService {
    private readonly logger = new Logger(StudentsService.name);
    /** Pencatatan percobaan kode kelas yang gagal untuk mencegah brute-force. */
    private readonly failedJoinAttempts = new Map<string, number[]>();

    constructor(private readonly db: DbService) {}

    private assertJoinRateLimit(userId: string) {
        const now = Date.now();
        const windowMs = 60_000; // Jendela 1 menit
        const maxAttempts = 5;

        const timestamps = (this.failedJoinAttempts.get(userId) || []).filter(
            (t) => now - t < windowMs,
        );

        if (timestamps.length >= maxAttempts) {
            throw new HttpException(
                'Terlalu banyak percobaan kode kelas yang salah. Harap tunggu 1 menit.',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        this.failedJoinAttempts.set(userId, timestamps);
    }

    private recordFailedJoinAttempt(userId: string) {
        const attempts = this.failedJoinAttempts.get(userId) || [];
        attempts.push(Date.now());
        this.failedJoinAttempts.set(userId, attempts);
    }

    // ── Kelas ────────────────────────────────────────────────────────────────

    /**
     * Kelas yang diikuti siswa: kelas reguler (`cbt_classes`) dan kelas tambahan
     * (`cbt_additional_classes`), yang merupakan dua tabel terpisah dengan tabel
     * keanggotaannya masing-masing.
     */
    async listClasses(user: AuthUser) {
        const [{ data: regular }, { data: additional }] = await Promise.all([
            this.db
                .from('cbt_class_members')
                .select(
                    `classes:cbt_classes(
                        id, name, type, program, organization_id,
                        organizations:cbt_organizations(name)
                    )`,
                )
                .eq('user_id', user.id),
            this.db
                .from('cbt_additional_class_members')
                .select(
                    `classes:cbt_additional_classes(
                        id, name, organization_id,
                        organizations:cbt_organizations(name)
                    )`,
                )
                .eq('user_id', user.id),
        ]);

        return [
            ...this.mapMemberships(regular, 'reguler'),
            ...this.mapMemberships(additional, 'tambahan'),
        ];
    }

    private mapMemberships(rows: unknown, type: 'reguler' | 'tambahan') {
        return ((rows as any[]) || [])
            .map((membership) => {
                // Relasi satu-ke-satu kadang terbaca sebagai array satu elemen,
                // tergantung bagaimana foreign key-nya terdaftar.
                const cls = Array.isArray(membership.classes)
                    ? membership.classes[0]
                    : membership.classes;
                if (!cls) return null;

                const org = Array.isArray(cls.organizations)
                    ? cls.organizations[0]
                    : cls.organizations;

                return {
                    id: cls.id,
                    name: cls.name,
                    type,
                    ...(type === 'reguler' ? { program: cls.program || 'Reguler' } : {}),
                    orgName: org?.name || 'Sekolah',
                };
            })
            .filter((cls): cls is NonNullable<typeof cls> => cls !== null);
    }

    /**
     * Gabung ke kelas tambahan memakai kode undangan.
     *
     * Kelas reguler tidak bisa dimasuki lewat kode: keanggotaannya berasal dari
     * data induk sekolah.
     */
    async joinClass(user: AuthUser, joinCode: string) {
        this.assertJoinRateLimit(user.id);

        const normalizedCode = joinCode.trim().toUpperCase();
        const { data: cls } = await this.db
            .from('cbt_additional_classes')
            .select('id, name, organization_id')
            .eq('join_code', normalizedCode)
            .maybeSingle();

        if (!cls) {
            this.recordFailedJoinAttempt(user.id);
            throw new NotFoundException('Kode kelas tidak valid atau tidak ditemukan.');
        }

        const row = cls as { id: string; name: string; organization_id: string };

        // Kode kelas saja tidak cukup: siswa harus memang anggota sekolah itu.
        // Tanpa pemeriksaan ini, satu kode yang bocor membuka kelas bagi siapa
        // pun yang punya akun.
        const { data: member } = await this.db
            .from('cbt_organization_members')
            .select('id')
            .eq('user_id', user.id)
            .eq('organization_id', row.organization_id)
            .eq('is_active', true)
            .maybeSingle();

        if (!member) {
            this.recordFailedJoinAttempt(user.id);
            throw new ForbiddenException('Anda bukan anggota aktif sekolah pemilik kelas ini.');
        }

        const { data: existing } = await this.db
            .from('cbt_additional_class_members')
            .select('id')
            .eq('class_id', row.id)
            .eq('user_id', user.id)
            .maybeSingle();

        if (existing) throw new ConflictException('Anda sudah terdaftar di kelas ini.');

        const { error } = await this.db
            .from('cbt_additional_class_members')
            .insert({ class_id: row.id, user_id: user.id });

        if (error) throw new BadRequestException(error.message);

        // Bersihkan riwayat gagal jika berhasil bergabung
        this.failedJoinAttempts.delete(user.id);

        return { className: row.name };
    }

    async leaveClass(user: AuthUser, classId: string) {
        const { data: cls } = await this.db
            .from('cbt_additional_classes')
            .select('name')
            .eq('id', classId)
            .maybeSingle();

        // Pencarian yang dibatasi ke kelas tambahan sekaligus jadi penjagaannya:
        // kelas reguler tidak ditemukan di sini, dan siswa memang tidak boleh
        // mengeluarkan dirinya dari kelas reguler.
        if (!cls) {
            throw new NotFoundException(
                'Kelas tambahan tidak ditemukan atau tidak dapat ditinggalkan.',
            );
        }

        const { error } = await this.db
            .from('cbt_additional_class_members')
            .delete()
            .eq('class_id', classId)
            .eq('user_id', user.id);

        if (error) throw new BadRequestException(error.message);

        return { className: (cls as { name: string }).name };
    }

    // ── Jadwal ujian ─────────────────────────────────────────────────────────

    /**
     * Ujian yang terlihat oleh siswa.
     *
     * Sumbernya dua: penugasan ke kelasnya (`cbt_exam_targets`) dan kepesertaan
     * perorangan (`cbt_exam_participants`). Konsep "ujian global" dari produk
     * asal — tryout publik lintas sekolah — sudah dihapus; pemasangan ini satu
     * sekolah.
     */
    async listExams(user: AuthUser) {
        const audience = await loadExamAudience(this.db, user);
        if (!audience.organizationId) return [];

        // Ujian yang jendelanya belum dibuka tetap ditampilkan (siswa perlu tahu
        // jadwalnya); riwayat yang sudah ditutup juga tetap ditampilkan.
        const { data: exams, error } = await this.db
            .from('cbt_exams')
            .select(
                `id, organization_id, title, description, status, is_published, start_time, end_time,
                 duration_minutes, exam_type, question_bank_id, created_at, metadata`,
            )
            .eq('organization_id', audience.organizationId)
            .eq('is_published', true)
            .order('start_time', { ascending: true });

        if (error) {
            this.logger.error(`Gagal membaca jadwal ujian siswa: ${error.message}`);
            throw new InternalServerErrorException('Jadwal ujian belum dapat dimuat.');
        }

        const visibleExams = ((exams as any[]) || []).filter(exam => canAccessExam(exam, audience));
        const ids = visibleExams.map(exam => exam.id);
        if (!ids.length) return [];

        const { data: attempts, error: attemptsError } = await this.db
            .from('cbt_exam_attempts')
            .select('exam_id, status')
            .eq('user_id', user.id)
            .in('exam_id', ids);

        if (attemptsError) throw new InternalServerErrorException('Status pengerjaan ujian belum dapat dimuat.');
        const rows = (attempts as Array<{ exam_id: string; status: string }>) || [];
        const completed = new Set(
            rows.filter((a) => FINISHED_STATUSES.includes(a.status)).map((a) => a.exam_id),
        );
        const inProgress = new Set(
            rows.filter((a) => a.status === 'in_progress').map((a) => a.exam_id),
        );

        return visibleExams.map((exam) => ({
            ...exam,
            isCompleted: completed.has(exam.id),
            isInProgress: inProgress.has(exam.id),
        }));
    }

    /**
     * Keterangan satu ujian untuk layar pengerjaan, beserta identitas peserta.
     *
     * Kolomnya dipilih satu per satu, bukan `select('*')`: baris ujian memuat
     * hal yang tidak boleh sampai ke peserta — antara lain `scoring_type` dan
     * pembuatnya — dan layar ujian memang tidak membutuhkannya.
     *
     * Identitas ikut dikembalikan karena kepala layar ujian menampilkan
     * "Nama • NISN". Sebelumnya halaman menanyakannya sendiri ke basis data dari
     * BROWSER; itu jalur terakhir di aplikasi ini yang menyentuh database tanpa
     * melewati NestJS.
     */
    async getExamForAttempt(user: AuthUser, examId: string) {
        const { data } = await this.db
            .from('cbt_exams')
            .select(
                `id, organization_id, title, description, exam_type, duration_minutes, question_bank_id,
                 start_time, end_time, is_published, status, show_results, metadata,
                 question_banks:cbt_question_banks(id, title)`,
            )
            .eq('id', examId)
            .maybeSingle();

        if (!data) throw new NotFoundException('Ujian tidak ditemukan.');

        await assertExamAccess(this.db, user, data);

        const { data: profile } = await this.db
            .from('cbt_profiles')
            .select('full_name, identity_number')
            .eq('id', user.id)
            .maybeSingle();

        // Pemeriksaan ini hanya membaca status; membuka layar persiapan tidak
        // boleh membuat attempt atau mengubah batas waktu siswa.
        const { data: startedAttempt, error: attemptError } = await this.db
            .from('cbt_exam_attempts')
            .select('id')
            .eq('exam_id', examId)
            .eq('user_id', user.id)
            .in('status', ['in_progress', 'submitted', 'auto_submitted'])
            .limit(1)
            .maybeSingle();
        if (attemptError) throw new BadRequestException('Status pengerjaan belum dapat diperiksa.');

        return { exam: data, profile: profile ?? null, hasStartedAttempt: Boolean(startedAttempt) };
    }

    // ── Hasil ────────────────────────────────────────────────────────────────

    async listResults(user: AuthUser) {
        const { data, error } = await this.db
            .from('cbt_exam_attempts')
            .select(
                `id, total_score, score_irt, finished_at, status, needs_manual_grading,
                 exams:cbt_exams(title, duration_minutes, show_results, scoring_type)`,
            )
            .eq('user_id', user.id)
            .in('status', FINISHED_STATUSES)
            .order('finished_at', { ascending: false });

        if (error) {
            this.logger.error(`Gagal membaca riwayat nilai: ${error.message}`);
            throw new InternalServerErrorException('Hasil ujian belum dapat dimuat. Silakan coba lagi.');
        }
        return ((data as any[]) || []).map(row => row.exams?.show_results === true ? row : {
            ...row, total_score: null, score_irt: null,
        });
    }

    /**
     * Rincian hasil satu pengerjaan, termasuk kunci jawaban.
     *
     * Nilai mengikuti show_results; rincian jawaban mengikuti izin pembahasan
     * yang terpisah. Pembahasan tertutup tidak boleh menghalangi ringkasan nilai.
     */
    async getAttemptDetails(user: AuthUser, attemptId: string) {
        const { data: attempt, error: attemptError } = await this.db
            .from('cbt_exam_attempts')
            .select(
                `id, total_score, status, needs_manual_grading, user_id, started_at, finished_at,
                 personal_end_time, score_irt, metadata,
                 exams:cbt_exams(id, title, show_results, question_bank_id, scoring_type, end_time, duration_minutes, metadata)`,
            )
            .eq('id', attemptId)
            .maybeSingle();

        if (attemptError) throw new InternalServerErrorException('Hasil ujian belum dapat dimuat. Silakan coba lagi.');
        if (!attempt) throw new NotFoundException('Hasil ujian tidak ditemukan.');

        const row = attempt as any;
        if (row.user_id !== user.id) {
            throw new ForbiddenException('Anda hanya dapat melihat hasil ujian Anda sendiri.');
        }
        if (!FINISHED_STATUSES.includes(row.status)) {
            throw new ForbiddenException('Hasil hanya tersedia setelah pengerjaan selesai.');
        }
        if (row.exams?.show_results !== true) {
            throw new ForbiddenException('Hasil ujian ini belum dibuka oleh guru.');
        }

        // Never return exam configuration or submission metadata in a score summary.
        const publicAttempt = {
            id: row.id, total_score: row.total_score, score_irt: row.score_irt,
            status: row.status, needs_manual_grading: row.needs_manual_grading,
            started_at: row.started_at, finished_at: row.finished_at,
            personal_end_time: row.personal_end_time,
            metadata: { dimension_scores: row.metadata?.dimension_scores || {} },
            exams: { id: row.exams.id, title: row.exams.title, show_results: true,
                question_bank_id: row.exams.question_bank_id, scoring_type: row.exams.scoring_type },
        };
        try {
            await assertAnswerKeysReleased(this.db, row.exams);
        } catch (error) {
            if (!(error instanceof ForbiddenException)) throw error;
            return {
                attempt: publicAttempt, answerKeysReleased: false,
                answerKeysMessage: error.message,
                dimensions: [], interpretations: [], answers: [],
            };
        }

        const { data: answers, error } = await this.db
            .from('cbt_answers')
            .select(
                `id, selected_option_id, essay_answer, is_correct, score, question_id,
                 bank_questions:cbt_bank_questions(
                     id, question_text, type, score_default, metadata,
                     bank_question_options:cbt_bank_question_options(id, option_text, is_correct, weight, metadata, order)
                 )`,
            )
            .eq('attempt_id', attemptId);

        if (error) throw new BadRequestException(error.message);

        const bankId = row.exams?.question_bank_id;

        // Dimensi dibatasi ke bank soal ujian ini. Versi lama membaca SELURUH
        // baris `cbt_question_dimensions` tanpa filter, yang pada basis data
        // dengan banyak bank berarti mengirimkan dimensi milik bank lain ke
        // browser siswa.
        const [{ data: dimensions }, { data: interpretations }] = await Promise.all([
            bankId
                ? this.db
                      .from('cbt_question_dimensions')
                      .select('id, name')
                      .eq('bank_id', bankId)
                : Promise.resolve({ data: [] }),
            bankId
                ? this.db
                      .from('cbt_dimension_interpretations')
                      .select('*, question_dimensions:cbt_question_dimensions!inner(bank_id)')
                      .eq('question_dimensions.bank_id', bankId)
                      .order('min_score', { ascending: true })
                : Promise.resolve({ data: [] }),
        ]);

        return {
            attempt: publicAttempt,
            answerKeysReleased: true,
            answerKeysMessage: null,
            dimensions: (dimensions as any[]) || [],
            interpretations: (interpretations as any[]) || [],
            answers: ((answers as any[]) || []).map((answer) => ({
                id: answer.id,
                questionId: answer.question_id,
                selectedOptionId: answer.selected_option_id,
                essayAnswer: answer.essay_answer,
                isCorrect: answer.is_correct,
                score: answer.score,
                question: answer.bank_questions
                    ? {
                          id: answer.bank_questions.id,
                          question_text: answer.bank_questions.question_text,
                          type: answer.bank_questions.type,
                          score_default: answer.bank_questions.score_default,
                          metadata: answer.bank_questions.metadata,
                          options: answer.bank_questions.bank_question_options || [],
                      }
                    : null,
            })),
        };
    }
}
