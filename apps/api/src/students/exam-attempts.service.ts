import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { studentScoreType, type AuthUser } from '@acca-cbt/shared';
import { isEssayType, toAnswerColumns, usesTextColumn } from '../common/answer-storage';
import { examDeadline, hasActiveSubmitIntent } from '../common/exam-deadline';
import { hasBoundSubmitIntent, submissionDigest, type SubmissionPayload } from '../common/submission-commitment';
import { persistSubmissionSecurityEvents, validateSubmissionSecurityEvents,
    type SubmissionSecurityEvent } from '../common/student-security-events';
import {
    ensureExamQuestionSnapshotsInTransaction,
    loadFrozenExamQuestions,
    readExamQuestionVersion,
} from '../common/exam-question-snapshots';
import {
    examUsesQuestionGroups,
    orderQuestionsForStudent,
    shuffleOptionsForStudent,
} from '../common/question-order';
import { advisoryTransactionLock } from '../common/transaction-lock';
import { getSchoolTimeZoneLabel, utcToLocalClock } from '../common/school-time';
import { GradingService } from '../grading/grading.service';
import { SettingsService } from '../settings/settings.service';
import { DbService, type DbSession } from '../prisma/prisma-db-adapter';
import { ScoringClient } from '../scoring/scoring.client';
import { assertExamAccess } from './exam-access';
import { studentQuestion } from './student-question';

/** Durasi bawaan bila ujian tidak menyimpannya. */
const DEFAULT_DURATION_MINUTES = 60;

export interface AnswerInput {
    questionId: string;
    selected_option_id?: string;
    essay_answer?: string;
    is_doubtful?: boolean;
    revision?: number;
}

/**
 * Jalur pengerjaan ujian: memulai, menyimpan jawaban, dan mengumpulkan.
 *
 * Dipindahkan dari `apps/web/app/actions/siswa.ts`. Inilah bagian paling kritis
 * dari seluruh migrasi — kesalahan di sini berarti jawaban siswa hilang saat
 * ujian berlangsung — jadi aturannya dipertahankan apa adanya, kecuali pada tiga
 * hal yang memang dirapikan:
 *
 *  - `userId` tidak lagi diterima sebagai parameter. Versi lama menerimanya lalu
 *    langsung menimpanya dengan identitas sesi (`userId = caller.id`), jadi
 *    parameternya memang sudah tidak berarti; di sini ia hilang sepenuhnya.
 *  - Penilaian dihitung FastAPI lewat `/grading/attempt`, bukan oleh salinan
 *    `calculateSingleAnswerScore` di sisi web. Dengan begitu submit, penilaian
 *    ulang, dan penutupan otomatis memakai satu implementasi yang sama.
 *  - Pemetaan jawaban ke kolom `cbt_answers` memakai `common/answer-storage`,
 *    bukan daftar tipe yang disalin ulang di tiap fungsi.
 *
 * Yang TIDAK diubah, karena semuanya jawaban atas kejadian nyata: waktu server
 * sebagai satu-satunya acuan, penguncian perangkat, rekonstruksi
 * `personal_end_time` yang kosong, idempotensi submit, dan penyimpanan status
 * terpisah dari metadata.
 */
@Injectable()
export class ExamAttemptsService {
    private readonly logger = new Logger(ExamAttemptsService.name);

    constructor(
        private readonly db: DbService,
        private readonly scoring: ScoringClient,
        private readonly grading: GradingService,
        private readonly settings?: SettingsService,
    ) {}

    // ── Soal ─────────────────────────────────────────────────────────────────

    /**
     * Soal dan opsi untuk halaman ujian.
     *
     * `is_correct` sengaja TIDAK ikut dipilih: kunci jawaban tidak boleh pernah
     * sampai ke browser siswa, dan satu-satunya cara memastikannya adalah tidak
     * mengambilnya sama sekali dari basis data.
     */
    async getQuestions(user: AuthUser, examId: string, deviceId?: string) {
        const device = this.requireDeviceId(deviceId);
        const { data: exam } = await this.db
            .from('cbt_exams')
            .select(
                'id, organization_id, metadata, start_time, end_time, duration_minutes, question_bank_id, is_published, exam_type, randomize_questions, randomize_options',
            )
            .eq('id', examId)
            .maybeSingle();

        if (!exam) throw new NotFoundException('Ujian tidak ditemukan.');
        await assertExamAccess(this.db, user, exam);
        if (exam.start_time && await this.serverNow() < new Date(exam.start_time)) {
            throw new ForbiddenException('Soal belum tersedia sebelum ujian dimulai.');
        }

        const { data: active, error: attemptError } = await this.db.from('cbt_exam_attempts')
            .select('id, started_at, personal_end_time, metadata, device_fingerprint')
            .eq('exam_id', examId).eq('user_id', user.id).eq('status', 'in_progress').maybeSingle();
        if (attemptError) throw new BadRequestException('Sesi pengerjaan belum dapat diperiksa.');
        const deadline = active ? examDeadline(active, exam) : new Date(NaN);
        if (!active || active.device_fingerprint !== device || active.metadata?.recovery_submit_only === true ||
            !Number.isFinite(deadline.getTime()) || await this.serverNow() >= deadline) {
            throw new ForbiddenException('Soal hanya tersedia selama sesi pengerjaan aktif.');
        }

        const row = exam as {
            question_bank_id: string | null;
            is_published: boolean;
            randomize_questions: boolean | null;
            randomize_options: boolean | null;
        };

        if (!row.is_published) {
            throw new ForbiddenException('Ujian belum dipublikasikan oleh proktor.');
        }
        const questions = await loadFrozenExamQuestions(
            this.db,
            examId,
            row.question_bank_id,
        );

        // Urutan soal diambil dari `common/question-order`, bukan disalin ulang:
        // layar review hasil memakai fungsi yang sama, dan begitu keduanya
        // berbeda satu langkah saja, "soal nomor 7" di review berhenti merujuk
        // soal yang benar-benar dikerjakan siswa.
        const ordered = orderQuestionsForStudent(questions, {
            userId: user.id,
            examId,
            randomize: row.randomize_questions,
            groups: examUsesQuestionGroups((exam as { metadata?: unknown }).metadata),
        });

        return {
            questions: shuffleOptionsForStudent(ordered, {
                userId: user.id,
                examId,
                randomize: row.randomize_options,
            }).map(question => studentQuestion(question, `${user.id}:${examId}`)),
        };
    }

    /**
     * Periksa pembaruan soal saat ujian sedang berlangsung (hot-update).
     */
    async checkQuestionUpdates(
        user: AuthUser,
        examId: string,
        knownRevisions: Record<string, number> = {},
        deviceId?: string,
    ) {
        const full = await this.getQuestions(user, examId, deviceId);
        const updatedQuestions = full.questions.filter((q) => {
            const clientRev = knownRevisions[q.id] ?? 1;
            const currentRev = (q as any).revision ?? 1;
            return currentRev > clientRev;
        });

        return {
            hasUpdates: updatedQuestions.length > 0,
            updatedQuestionIds: updatedQuestions.map((q) => q.id),
            questions: updatedQuestions,
        };
    }

    // ── Memulai / melanjutkan ────────────────────────────────────────────────

    /**
     * Mulai atau lanjutkan pengerjaan.
     *
     * Seluruh keputusan waktu memakai jam basis data, bukan jam perangkat: siswa
     * yang memundurkan jam laptopnya tidak boleh bisa membuka ujian lebih awal
     * atau memperpanjang durasinya.
     */
    async start(user: AuthUser, examId: string, deviceId?: string, screenCaptureReady = false) {
        const now = await this.serverNow();

        const { data: exam } = await this.db
            .from('cbt_exams')
            .select(
                'id, organization_id, question_bank_id, is_published, start_time, end_time, duration_minutes, status, metadata',
            )
            .eq('id', examId)
            .maybeSingle();

        if (!exam) throw new NotFoundException('Ujian tidak ditemukan.');

        await assertExamAccess(this.db, user, exam);
        if (exam.metadata?.screenshot_enabled === true && !screenCaptureReady) {
            const { data: exception, error: exceptionError } = await this.db.from('cbt_exam_screen_share_exceptions')
                .select('user_id').eq('exam_id', examId).eq('user_id', user.id).maybeSingle();
            if (exceptionError) throw new BadRequestException('Izin pengecualian berbagi layar belum dapat diperiksa.');
            if (!exception) throw new ForbiddenException('Bagikan seluruh layar sebelum memulai atau melanjutkan ujian.');
        }
        const device = this.requireDeviceId(deviceId);

        const row = exam as {
            organization_id: string;
            is_published: boolean;
            start_time: string | null;
            end_time: string | null;
            duration_minutes: number | null;
        };

        // Ambil attempt aktif sebelum memutuskan jendela global. Reset proktor
        // dapat memberi grace period bertanda khusus setelah jadwal global
        // berakhir untuk memulihkan jawaban lokal yang tertahan.
        const { data: existing } = await this.db
            .from('cbt_exam_attempts')
            .select('*')
            .eq('user_id', user.id)
            .eq('exam_id', examId)
            .eq('status', 'in_progress')
            .maybeSingle();
        const recoveryUntil = this.proctorRecoveryUntil(existing as any);
        const recoveryActive = recoveryUntil !== null && now < recoveryUntil;
        const submitPending = hasActiveSubmitIntent((existing as any)?.metadata, now);

        if (!row.is_published) {
            return this.refuse('Ujian belum dipublikasikan oleh proktor.');
        }

        if (row.start_time && now < new Date(row.start_time)) {
            const timeZone = (await this.settings?.getSchoolTimeZone?.()) || 'Asia/Jakarta';
            return this.refuse(
                `Ujian belum dimulai. Window dibuka pk ${utcToLocalClock(row.start_time, timeZone)} ${getSchoolTimeZoneLabel(timeZone)}.`,
            );
        }

        if (row.end_time && now > new Date(row.end_time) && !recoveryActive && !submitPending) {
            if (existing) await this.autoFinish((existing as { id: string }).id, now);
            const { data: closed } = existing ? { data: existing } : await this.db.from('cbt_exam_attempts')
                .select('id').eq('user_id', user.id).eq('exam_id', examId)
                .in('status', ['submitted', 'auto_submitted']).order('finished_at', { ascending: false }).limit(1).maybeSingle();
            return this.refuse('Waktu ujian telah berakhir.', {
                expiredAttemptId: (closed as { id: string } | null)?.id,
            });
        }

        const { data: completed } = await this.db
            .from('cbt_exam_attempts')
            .select('id, status, started_at, finished_at')
            .eq('user_id', user.id)
            .eq('exam_id', examId)
            .in('status', ['submitted', 'auto_submitted'])
            .maybeSingle();

        if (completed) {
            return this.refuse('Anda sudah menyelesaikan ujian ini.', {
                expiredAttemptId: (completed as { id: string }).id,
            });
        }

        if (existing) return this.resume(existing as any, row, now, device);

        // Dua tab dapat melewati pemeriksaan `existing` di atas pada saat yang
        // sama. Serialisasikan keputusan terakhir berdasarkan pasangan
        // siswa-ujian, lalu periksa ulang di dalam transaksi sebelum INSERT.
        // Dengan begitu retry start bersifat idempoten dan selalu kembali ke
        // attempt yang sudah menang.
        const decision = await this.createAttemptSafely(user, examId, row, now, device);
        if (decision.kind === 'completed') {
            return this.refuse('Anda sudah menyelesaikan ujian ini.', {
                expiredAttemptId: decision.attemptId,
            });
        }
        if (decision.kind === 'existing') {
            return this.resume(decision.attempt, row, now, device);
        }
        return decision.result;
    }

    /**
     * Buat satu attempt saja walaupun beberapa request start tiba bersamaan.
     *
     * Advisory lock hanya hidup selama transaksi dan memakai kunci stabil dari
     * exam + user. Unique index parsial pada migrasi tahap 15 menjadi pagar
     * database bila ada penulis lain yang tidak melewati service ini.
     */
    private async createAttemptSafely(
        user: AuthUser,
        examId: string,
        exam: { organization_id: string; end_time: string | null; duration_minutes: number | null },
        now: Date,
        device: string,
    ) {
        return this.db.transaction(async db => {
            await advisoryTransactionLock(db, `${examId}:${user.id}`);

            const { data: active, error: activeError } = await db
                .from('cbt_exam_attempts')
                .select('*')
                .eq('user_id', user.id)
                .eq('exam_id', examId)
                .eq('status', 'in_progress')
                .maybeSingle();
            if (activeError) {
                throw new BadRequestException('Status pengerjaan belum dapat diperiksa.');
            }
            if (active) {
                return { kind: 'existing' as const, attempt: active };
            }

            // Sesi dapat selesai di antara pemeriksaan awal dan saat lock
            // didapatkan. Jangan membuat attempt baru untuk retry semacam itu.
            const { data: completed, error: completedError } = await db
                .from('cbt_exam_attempts')
                .select('id')
                .eq('user_id', user.id)
                .eq('exam_id', examId)
                .in('status', ['submitted', 'auto_submitted'])
                .maybeSingle();
            if (completedError) {
                throw new BadRequestException('Status pengerjaan belum dapat diperiksa.');
            }
            if (completed) {
                return {
                    kind: 'completed' as const,
                    attemptId: (completed as { id: string }).id,
                };
            }

            return {
                kind: 'created' as const,
                result: await this.createAttempt(user, examId, exam, now, device, db),
            };
        });
    }

    /** Lanjutkan pengerjaan yang masih berjalan. */
    private async resume(
        attempt: any,
        exam: { end_time: string | null; duration_minutes: number | null },
        now: Date,
        device: string,
    ) {
        // ── Kunci perangkat ──────────────────────────────────────────────────
        // Pengerjaan terikat pada perangkat yang pertama memulainya; melanjutkan
        // dari perangkat lain ditolak, supaya tidak ada serah-terima diam-diam di
        // tengah ujian. Proktor bisa membukanya lewat "Reset".
        //
        // Disimpan di kolom `device_fingerprint` tersendiri, bukan di `metadata`,
        // supaya ujian tetap bisa dimulai pada basis data yang kolom metadata-nya
        // belum ada.
        const boundDevice: string | undefined = attempt.device_fingerprint || undefined;

        if (device) {
            if (boundDevice && boundDevice !== device) {
                // Dicatat sebagai jejak audit untuk pengawas, TETAPI dengan jenis
                // peristiwa yang tidak ikut dihitung sebagai pelanggaran —
                // kalau ikut, perangkat asli bisa ikut terhenti otomatis.
                await this.db.from('cbt_attempt_security_logs').insert({
                    attempt_id: attempt.id,
                    event_type: 'DEVICE_SWITCH_BLOCKED',
                    metadata: {
                        attempted_device: device,
                        bound_device: boundDevice,
                        at: now.toISOString(),
                    },
                });

                return this.refuse(
                    'Ujian ini terkunci pada perangkat yang pertama digunakan. Untuk melanjutkan di ' +
                        'perangkat lain, minta pengawas melakukan "Reset" pada ujian Anda.',
                );
            }

            if (!boundDevice) {
                // Pengerjaan dari sebelum kunci perangkat ada: ikat sekarang.
                await this.db
                    .from('cbt_exam_attempts')
                    .update({ device_fingerprint: device })
                    .eq('id', attempt.id);
                attempt.device_fingerprint = device;
            }
        }

        const personalEnd = this.resolvePersonalEnd(attempt, exam, now);

        if (now >= personalEnd && !hasActiveSubmitIntent((attempt as any).metadata, now)) {
            await this.autoFinish(attempt.id, now);
            // `expiredAttemptId` dikembalikan supaya klien masih bisa menyusulkan
            // jawaban yang hanya sempat tersimpan di localStorage — tanpa itu,
            // pengerjaan dinilai dari jawaban server saja dan jawaban offline
            // hilang tanpa jejak.
            return this.refuse('Waktu ujian telah berakhir.', {
                expiredAttemptId: attempt.id,
            });
        }

        await this.db
            .from('cbt_exam_attempts')
            .update({ last_seen_at: now.toISOString() })
            .eq('id', attempt.id)
            .eq('status', 'in_progress');

        const { data: answers, error: answersError } = await this.db
            .from('cbt_answers')
            .select('question_id, selected_option_id, essay_answer, is_doubtful, metadata')
            .eq('attempt_id', attempt.id);

        if (answersError) throw new ServiceUnavailableException('Jawaban tersimpan belum dapat dimuat. Coba lagi; jawaban di server tetap dipertahankan.');

        return {
            started: true as const,
            attempt,
            answers: (answers as any[]) || [],
            remainingSeconds: Math.floor((personalEnd.getTime() - now.getTime()) / 1000),
        };
    }

    private async createAttempt(
        user: AuthUser,
        examId: string,
        exam: { organization_id: string; end_time: string | null; duration_minutes: number | null },
        now: Date,
        device: string,
        db: DbSession = this.db,
    ) {
        await ensureExamQuestionSnapshotsInTransaction(db, examId);

        const personalEnd = this.capToWindow(
            new Date(
                now.getTime() +
                    (exam.duration_minutes || DEFAULT_DURATION_MINUTES) * 60 * 1000,
            ),
            exam.end_time,
        );

        const { data: attempt, error } = await db
            .from('cbt_exam_attempts')
            .insert({
                organization_id: exam.organization_id,
                exam_id: examId,
                user_id: user.id,
                status: 'in_progress',
                started_at: now.toISOString(),
                last_seen_at: now.toISOString(),
                personal_end_time: personalEnd.toISOString(),
                device_fingerprint: device || null,
            })
            .select()
            .maybeSingle();

        if (error || !attempt) {
            throw new BadRequestException(
                `Gagal memulai ujian: ${error?.message ?? 'tidak diketahui'}`,
            );
        }

        return {
            started: true as const,
            attempt,
            answers: [] as any[],
            remainingSeconds: Math.max(
                0,
                Math.floor((personalEnd.getTime() - now.getTime()) / 1000),
            ),
        };
    }

    /**
     * Batas waktu pribadi sebuah pengerjaan.
     *
     * Baris lama bisa punya `personal_end_time` kosong. Memakainya apa adanya
     * menghasilkan epoch 1970, yang membuat pengerjaan langsung ditutup otomatis
     * begitu siswa membukanya — jadi nilainya disusun ulang dari `started_at`
     * ditambah durasi ujian.
     */
    private resolvePersonalEnd(
        attempt: {
            personal_end_time: string | null;
            started_at: string | null;
            metadata?: Record<string, unknown> | null;
        },
        exam: { end_time: string | null; duration_minutes: number | null },
        now: Date,
    ): Date {
        return examDeadline(attempt, exam);
    }

    /** Batas pribadi tidak pernah melewati penutupan jendela ujian. */
    private capToWindow(personalEnd: Date, windowEnd: string | null): Date {
        if (!windowEnd) return personalEnd;
        const close = new Date(windowEnd);
        return close < personalEnd ? close : personalEnd;
    }

    /** Grace period ini hanya dibuat oleh reset proktor, bukan oleh klien siswa. */
    private proctorRecoveryUntil(
        attempt: { metadata?: Record<string, unknown> | null } | null | undefined,
    ): Date | null {
        const raw = attempt?.metadata?.proctor_recovery_until;
        if (typeof raw !== 'string') return null;
        const value = new Date(raw);
        return Number.isFinite(value.getTime()) ? value : null;
    }

    /**
     * Tutup pengerjaan yang kehabisan waktu, DAN nilai dari jawaban tersimpan.
     *
     * Penilaiannya wajib: jalur ini tidak melewati submit normal, dan sebelum ada
     * ini pengerjaan semacam itu ditandai `auto_submitted` tanpa pernah punya
     * skor — seluruh `is_correct`-nya null.
     */
    private async autoFinish(attemptId: string, now: Date,
        evidence?: { user: AuthUser; device: string; events: SubmissionSecurityEvent[] }): Promise<void> {
        const closed = await this.db.transaction(async db => {
            await db.raw('SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE', attemptId);
            const { data: current, error: readError } = await db.from('cbt_exam_attempts')
                .select('status, metadata, user_id, device_fingerprint, started_at, personal_end_time, exam_id').eq('id', attemptId).maybeSingle();
            if (readError) throw new BadRequestException('Status pengerjaan belum dapat diperiksa.');
            if (!current || current.status !== 'in_progress' || hasActiveSubmitIntent(current.metadata, now)) return false;
            if (evidence?.events.length && current.user_id === evidence.user.id &&
                (!current.device_fingerprint || current.device_fingerprint === evidence.device)) {
                const { data: exam, error: examError } = await db.from('cbt_exams')
                    .select('end_time, duration_minutes').eq('id', current.exam_id).maybeSingle();
                if (examError || !exam) throw new BadRequestException('Batas waktu pengawasan belum dapat diperiksa.');
                await persistSubmissionSecurityEvents(db, attemptId, evidence.user.id, current,
                    evidence.events, now, examDeadline(current, exam));
            }
            const { data: updated, error } = await db
                .from('cbt_exam_attempts')
                .update({ status: 'auto_submitted', total_score: null, finished_at: now.toISOString(), metadata: { ...(current.metadata || {}), closed_by_expiry: true } })
                .eq('id', attemptId).eq('status', 'in_progress').select('id').maybeSingle();
            if (error) throw new BadRequestException('Status pengerjaan belum dapat disimpan.');
            return Boolean(updated);
        });
        if (!closed) return;

        try {
            const graded = await this.grading.gradeAttemptFromSavedAnswers(attemptId);
            if (graded) {
                await this.grading.applyRelativeQuizScoringIfQuiz(graded.examId);
            }
        } catch (err) {
            // Statusnya sudah tercatat; kegagalan penilaian tidak boleh membuat
            // pengerjaan seolah masih berjalan.
            this.logger.error(
                `Gagal menilai pengerjaan ${attemptId} saat waktu habis: ${(err as Error).message}`,
            );
        }
    }

    // ── Menyimpan jawaban ────────────────────────────────────────────────────

    async saveAnswer(user: AuthUser, attemptId: string, answer: AnswerInput, deviceId?: string) {
        const device = this.requireDeviceId(deviceId);
        await this.db.transaction(async db => {
            await db.raw('SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE', attemptId);
            const owned = await this.assertOwnedAndRunning(user, attemptId, db, device);
            await this.assertAnswersBelongToExam(owned.examId, [answer], db);
            await this.upsertAnswers(attemptId, [answer], db);
        });
        return { attemptId };
    }

    async syncAnswers(user: AuthUser, attemptId: string, answers: AnswerInput[], deviceId?: string) {
        if (answers.length === 0) return { attemptId, saved: 0 };
        const device = this.requireDeviceId(deviceId);

        await this.db.transaction(async db => {
            await db.raw('SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE', attemptId);
            const owned = await this.assertOwnedAndRunning(user, attemptId, db, device);
            await this.assertAnswersBelongToExam(owned.examId, answers, db);
            await this.upsertAnswers(attemptId, answers, db);
        });

        return { attemptId, saved: answers.length };
    }

    /** Read-only preflight for the application-wide delivery queue. */
    async submissionStatus(user: AuthUser, attemptId: string, deviceId?: string) {
        const device = this.requireDeviceId(deviceId);
        const { data: attempt, error } = await this.db.from('cbt_exam_attempts')
            .select('id, exam_id, user_id, status, started_at, personal_end_time, device_fingerprint, metadata')
            .eq('id', attemptId).maybeSingle();
        if (error) throw new BadRequestException('Status pengiriman belum dapat dibaca.');
        if (!attempt || attempt.user_id !== user.id || attempt.device_fingerprint !== device) {
            throw new ForbiddenException('Sesi atau perangkat pengiriman tidak cocok.');
        }
        const { data: exam, error: examError } = await this.db.from('cbt_exams')
            .select('end_time, duration_minutes').eq('id', attempt.exam_id).maybeSingle();
        if (examError || !exam) throw new BadRequestException('Batas waktu belum dapat diperiksa.');
        const now = await this.serverNow();
        const deadline = examDeadline(attempt, exam);
        if (!Number.isFinite(deadline.getTime())) throw new BadRequestException('Batas waktu tidak valid.');
        return {
            examId: attempt.exam_id, status: attempt.status, startedAt: attempt.started_at,
            personalEndTime: attempt.personal_end_time,
            remainingSeconds: Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 1000)),
            submissionOnly: attempt.metadata?.recovery_submit_only === true,
            canRecover: attempt.status === 'in_progress' || attempt.status === 'submitted' ||
                (attempt.status === 'auto_submitted' && attempt.metadata?.closed_by_expiry === true &&
                    attempt.metadata?.recovery_submit_only !== true),
        };
    }

    async beginSubmit(user: AuthUser, attemptId: string, deviceId?: string, submission?: SubmissionPayload) {
        const device = this.requireDeviceId(deviceId);
        const securityEvents = validateSubmissionSecurityEvents(submission?.securityEvents);
        const digest = submission ? submissionDigest(submission) : undefined;
        return this.db.transaction(async db => {
            await db.raw('SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE', attemptId);
            const { data: attempt, error } = await db.from('cbt_exam_attempts')
                .select('user_id, status, device_fingerprint, metadata, personal_end_time, started_at, exam_id')
                .eq('id', attemptId).maybeSingle();
            if (error || !attempt) throw new ForbiddenException('Sesi pengerjaan tidak ditemukan.');
            if (attempt.user_id !== user.id) throw new ForbiddenException('Tidak diizinkan.');
            if (attempt.device_fingerprint && attempt.device_fingerprint !== device) {
                throw new ForbiddenException('Perangkat tidak cocok dengan sesi pengerjaan.');
            }
            if (['submitted', 'auto_submitted'].includes(attempt.status)) {
                const acceptedSecurityEventIds = await persistSubmissionSecurityEvents(db, attemptId, user.id,
                    attempt, securityEvents, new Date(), new Date(NaN));
                return { attemptId, startedAt: null, alreadySubmitted: true,
                    ...(submission?.securityEvents ? { acceptedSecurityEventIds } : {}) };
            }
            if (attempt.status !== 'in_progress') throw new ForbiddenException('Ujian tidak sedang berlangsung.');
            const [clock] = await db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
            const now = new Date(clock.now);
            const { data: exam, error: examError } = await db.from('cbt_exams')
                .select('end_time, duration_minutes').eq('id', attempt.exam_id).maybeSingle();
            if (examError || !exam) throw new BadRequestException('Batas waktu pengerjaan belum dapat diperiksa.');
            const deadline = this.resolvePersonalEnd(attempt, exam, now);
            if (hasActiveSubmitIntent(attempt.metadata, now)) {
                if (attempt.metadata?.submit_intent_digest === digest) {
                    const acceptedSecurityEventIds = await persistSubmissionSecurityEvents(db, attemptId, user.id,
                        attempt, securityEvents, now, deadline);
                    return { attemptId, startedAt: attempt.metadata.submit_intent_at,
                        ...(submission?.securityEvents ? { acceptedSecurityEventIds } : {}) };
                }
                if (attempt.metadata?.submit_intent_digest) {
                    throw new ConflictException('Isi pengumpulan berbeda dari kiriman yang sudah dikunci. Hubungi proktor.');
                }
                // A legacy timestamp may be upgraded only while the exam is still open.
            }
            if (!Number.isFinite(deadline.getTime())) throw new BadRequestException('Batas waktu pengerjaan belum dapat diperiksa.');
            // Let submit finalize saved answers, without granting permission for late edits.
            if (now >= deadline) {
                const acceptedSecurityEventIds = await persistSubmissionSecurityEvents(db, attemptId, user.id,
                    attempt, securityEvents, now, deadline);
                return { attemptId, startedAt: null, savedAnswersOnly: true,
                    ...(submission?.securityEvents ? { acceptedSecurityEventIds } : {}) };
            }
            await this.assertOwnedAndRunning(user, attemptId, db, device, true);
            const acceptedSecurityEventIds = await persistSubmissionSecurityEvents(db, attemptId, user.id,
                attempt, securityEvents, now, deadline);
            const startedAt = now.toISOString();
            const { error: updateError } = await db.from('cbt_exam_attempts')
                .update({ metadata: { ...(attempt.metadata || {}), submit_intent_at: startedAt, submit_intent_digest: digest ?? null } })
                .eq('id', attemptId).eq('status', 'in_progress');
            if (updateError) throw new BadRequestException('Waktu mulai submit belum dapat dicatat.');
            return { attemptId, startedAt, ...(submission?.securityEvents ? { acceptedSecurityEventIds } : {}) };
        });
    }

    private async upsertAnswers(attemptId: string, answers: AnswerInput[], db: DbSession = this.db): Promise<void> {
        // The caller holds the attempt row lock, so version checks and writes
        // are serialized across autosave, bulk retry, beacon and submit.
        const { data: saved, error: readError } = await db.from('cbt_answers')
            .select('question_id, selected_option_id, essay_answer, is_doubtful, metadata')
            .eq('attempt_id', attemptId);
        if (readError) {
            this.logger.error(
                `Gagal membaca versi jawaban untuk attempt ${attemptId}: ${readError.message}` +
                    (readError.code ? ` (kode ${readError.code})` : ''),
            );
            throw new BadRequestException('Versi jawaban belum dapat diperiksa.');
        }
        const existing = new Map<string, any>((saved || []).map((row: any) => [row.question_id, row]));
        const [clock] = await db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
        const savedAt = new Date(clock.now).toISOString();
        const rows = new Map<string, any>();
        for (const answer of answers) {
            const previous = rows.get(answer.questionId) || existing.get(answer.questionId);
            const revision = answer.revision ?? 0;
            if (!Number.isSafeInteger(revision) || revision < 0) {
                throw new BadRequestException('Versi jawaban tidak valid.');
            }
            const previousRevision = Number(previous?.metadata?.answer_revision || 0);
            const row = {
                attempt_id: attemptId, question_id: answer.questionId,
                selected_option_id: answer.selected_option_id || null,
                essay_answer: answer.essay_answer || null,
                is_doubtful: answer.is_doubtful ?? previous?.is_doubtful ?? false,
                metadata: { ...(previous?.metadata || {}), answer_revision: revision, answer_saved_at: savedAt },
            };
            const same = previous && previous.selected_option_id === row.selected_option_id &&
                previous.essay_answer === row.essay_answer && Boolean(previous.is_doubtful) === row.is_doubtful;
            if (revision < previousRevision || (revision > 0 && revision === previousRevision && !same)) {
                throw new ConflictException('Ada versi jawaban yang lebih baru. Muat ulang halaman untuk menyelaraskan jawaban.');
            }
            if (revision === previousRevision && same) continue;
            rows.set(answer.questionId, row);
        }
        if (!rows.size) return;
        const { error } = await db.from('cbt_answers').upsert([...rows.values()],
            { onConflict: 'attempt_id, question_id' });
        if (error) throw new BadRequestException(error.message);
    }

    /**
     * Pastikan autosave hanya dapat membuat baris untuk soal ujian ini.
     *
     * Foreign key database hanya membuktikan UUID soal/opsi memang ada. Tanpa
     * pemeriksaan relasi ini, klien yang dimodifikasi dapat menempelkan soal
     * bank lain atau opsi milik soal lain ke attempt miliknya sendiri.
     */
    private async assertAnswersBelongToExam(
        examId: string,
        answers: AnswerInput[],
        db: DbSession = this.db,
    ): Promise<void> {
        const questions = await readExamQuestionVersion(db, examId);
        const byId = new Map<string, any>(questions.map(question => [question.id, question]));

        for (const answer of answers) {
            const question = byId.get(answer.questionId);
            if (!question) {
                throw new BadRequestException('Soal tidak termasuk dalam ujian yang sedang dikerjakan.');
            }

            const selectedOptionId = answer.selected_option_id?.trim();
            const essayAnswerProvided = answer.essay_answer !== undefined && answer.essay_answer !== '';
            if (selectedOptionId && essayAnswerProvided) {
                throw new BadRequestException('Jawaban tidak boleh memakai dua format sekaligus.');
            }

            if (usesTextColumn(question.type)) {
                if (selectedOptionId) {
                    throw new BadRequestException('Format jawaban tidak sesuai dengan tipe soal.');
                }
                continue;
            }

            if (essayAnswerProvided) {
                throw new BadRequestException('Format jawaban tidak sesuai dengan tipe soal.');
            }
            if (!selectedOptionId) continue;

            const optionIds = new Set<string>(
                ((question.bank_question_options as Array<{ id: string }> | null) || [])
                    .map(option => option.id),
            );
            if (!optionIds.has(selectedOptionId)) {
                throw new BadRequestException('Pilihan jawaban tidak termasuk dalam soal tersebut.');
            }
        }
    }

    /**
     * Pemilik pengerjaan, dan pengerjaannya masih berjalan.
     *
     * Menjaga seluruh jalur penulisan jawaban: tanpa ini, siswa bisa menimpa
     * jawaban siswa lain — atau menyunting pengerjaan yang sudah dikumpulkan —
     * hanya dengan menukar `attemptId`.
     */
    private async assertOwnedAndRunning(
        user: AuthUser,
        attemptId: string,
        db: DbSession = this.db,
        deviceId?: string,
        allowRecordedSubmitIntent = false,
        digest?: string,
    ): Promise<{ examId: string }> {
        const { data, error } = await db
            .from('cbt_exam_attempts')
            .select('user_id, status, exam_id, personal_end_time, started_at, device_fingerprint, metadata')
            .eq('id', attemptId)
            .maybeSingle();

        if (error) throw new BadRequestException('Pengerjaan belum dapat diperiksa.');
        const attempt = data as any;

        if (!attempt || attempt.user_id !== user.id) {
            throw new ForbiddenException('Tidak diizinkan.');
        }
        if (attempt.status !== 'in_progress') {
            throw new ForbiddenException('Ujian tidak sedang berlangsung.');
        }
        if (attempt.metadata?.recovery_submit_only === true && !allowRecordedSubmitIntent) {
            throw new ForbiddenException('Pemulihan hanya mengizinkan pengumpulan jawaban, bukan perubahan jawaban.');
        }

        if (attempt.device_fingerprint && attempt.device_fingerprint !== (deviceId || '').trim()) {
            throw new ForbiddenException('Perangkat tidak cocok dengan sesi pengerjaan.');
        }
        const { data: exam, error: examError } = await db.from('cbt_exams')
            .select('end_time, start_time, duration_minutes').eq('id', attempt.exam_id).maybeSingle();
        if (examError || !exam || (!attempt.personal_end_time && !attempt.started_at)) {
            throw new BadRequestException('Batas waktu pengerjaan belum dapat diperiksa. Hubungi proktor.');
        }
        const [clock] = await db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
        const now = new Date(clock.now);
        const deadline = this.resolvePersonalEnd(attempt, exam, now);
        if (!allowRecordedSubmitIntent && hasActiveSubmitIntent(attempt.metadata, now)) {
            throw new ConflictException('Jawaban sudah dikunci untuk pengumpulan.');
        }
        if (!Number.isFinite(deadline.getTime()) ||
            (now >= deadline && !(allowRecordedSubmitIntent && hasBoundSubmitIntent(attempt.metadata, now, deadline, digest)))) {
            throw new ForbiddenException({ code: 'EXAM_TIME_EXPIRED', message: 'Waktu ujian telah berakhir. Jawaban baru tidak dapat diterima.' });
        }
        if (exam.start_time && now < new Date(exam.start_time)) {
            throw new ForbiddenException('Ujian belum dimulai.');
        }
        return { examId: attempt.exam_id };
    }

    // ── Susulan jawaban ──────────────────────────────────────────────────────

    /**
     * Endpoint kompatibilitas untuk klien lama yang mencoba menyusulkan jawaban
     * setelah attempt ditutup. Perubahan jawaban setelah batas waktu tidak lagi
     * diterima otomatis. Proktor harus membuka attempt lewat reset; setelah itu
     * klien mengirim salinan lokal melalui jalur sinkronisasi biasa yang kembali
     * memeriksa status, perangkat, dan batas waktu.
     */
    async syncLateAnswers(
        user: AuthUser,
        attemptId: string,
        answers: AnswerInput[],
        deviceId?: string,
    ) {
        if (answers.length === 0) return { restored: 0 };

        const { data } = await this.db
            .from('cbt_exam_attempts')
            .select('id, user_id, exam_id, status, finished_at, device_fingerprint')
            .eq('id', attemptId)
            .maybeSingle();

        const attempt = data as {
            user_id: string;
            exam_id: string;
            status: string;
            finished_at: string | null;
            device_fingerprint: string | null;
        } | null;

        if (!attempt || attempt.user_id !== user.id) {
            throw new ForbiddenException('Tidak diizinkan.');
        }
        if (attempt.status !== 'auto_submitted') {
            throw new ForbiddenException(
                'Susulan jawaban hanya berlaku untuk ujian yang ditutup otomatis oleh sistem.',
            );
        }

        this.requireDeviceId(deviceId);
        throw new ForbiddenException(
            'Pemulihan jawaban setelah ujian ditutup memerlukan reset dari proktor.',
        );
    }

    /** Client freezing is not proof of when answers were written. Late uploads require staff recovery. */
    private async assertFrozenSubmission(
        user: AuthUser, attempt: any,
        snapshot: { startedAt: string; personalEndTime: string }, device: string, db: DbSession, digest: string,
    ): Promise<void> {
        if (attempt.user_id !== user.id || attempt.device_fingerprint !== device ||
            Date.parse(attempt.started_at || '') !== Date.parse(snapshot.startedAt)) {
            throw new ForbiddenException('Salinan jawaban tidak cocok dengan sesi atau perangkat ini.');
        }
        const recovery = attempt.metadata?.recovery_submit_only === true;
        const sourceDeadline = recovery ? attempt.metadata?.recovery_source_deadline : attempt.personal_end_time;
        const matchesDeadline = Date.parse(snapshot.personalEndTime) === Date.parse(sourceDeadline || '') ||
            (recovery && Date.parse(snapshot.personalEndTime) === Date.parse(attempt.personal_end_time || ''));
        if (!matchesDeadline) throw new ForbiddenException('Salinan jawaban berasal dari sesi yang sudah diganti.');
        if (attempt.status !== 'in_progress' &&
            !(attempt.status === 'auto_submitted' && attempt.metadata?.closed_by_expiry === true && !recovery)) {
            throw new ForbiddenException('Sesi ditutup oleh pengawas atau pelanggaran; hubungi proktor.');
        }
        const [clock] = await db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
        const now = new Date(clock.now);
        if (recovery && now >= new Date(attempt.personal_end_time)) {
            throw new ForbiddenException('Jendela pengumpulan pemulihan telah berakhir.');
        }
        const { data: exam, error } = await db.from('cbt_exams')
            .select('start_time, end_time, duration_minutes').eq('id', attempt.exam_id).maybeSingle();
        if (error || !exam) throw new BadRequestException('Ujian belum dapat diverifikasi.');
        if (exam.start_time && now < new Date(exam.start_time)) throw new ForbiddenException('Ujian belum dimulai.');
        const deadline = examDeadline(attempt, exam);
        const timelyIntent = !recovery && attempt.status === 'in_progress' &&
            hasBoundSubmitIntent(attempt.metadata, now, deadline, digest);
        if (!Number.isFinite(deadline.getTime()) || (now >= deadline && !timelyIntent)) {
            throw new ForbiddenException({ code: 'RECOVERY_REQUIRED',
                message: 'Waktu ujian telah berakhir. Jawaban lokal tetap disimpan; hubungi proktor untuk membuka pemulihan.' });
        }

    }

    // ── Pengumpulan ──────────────────────────────────────────────────────────

    /**
     * Kumpulkan ujian: nilai jawaban, catat statusnya, simpan jawabannya.
     *
     * Bersifat idempoten. Klien yang kehilangan jaringan tepat setelah submit
     * akan mencoba lagi, dan pengumpulan kedua untuk pengerjaan yang sudah
     * tercatat harus dijawab "berhasil" — bukan galat yang membuat klien
     * mengulang tanpa henti pada ujian yang sebenarnya sudah tersimpan.
     */
    async submit(
        user: AuthUser, examId: string, studentAnswers: Record<string, string>,
        assignmentData?: Record<string, unknown>, clientAttemptId?: string, deviceId?: string,
        answerRevisions?: Record<string, number>,
        frozenSubmission?: { startedAt: string; personalEndTime: string },
        securityEvents?: SubmissionSecurityEvent[],
    ) {
        const manifest = validateSubmissionSecurityEvents(securityEvents);
        let result: Awaited<ReturnType<ExamAttemptsService['submitInternal']>>;
        try {
            result = await this.submitInternal(user, examId, studentAnswers, assignmentData,
                clientAttemptId, deviceId, answerRevisions, frozenSubmission, manifest);
        } catch (error) {
            // Expiry may win the race with the final click. Acknowledge only
            // answers already persisted exactly; never accept new late edits.
            const expired = error instanceof ForbiddenException &&
                (error.getResponse() as { code?: string }).code === 'RECOVERY_REQUIRED';
            if (!expired || !clientAttemptId || !frozenSubmission ||
                !await this.verifyStoredSubmission(user, examId, clientAttemptId, deviceId!, studentAnswers,
                    answerRevisions, assignmentData, frozenSubmission, true)) throw error;
            await this.autoFinish(clientAttemptId, await this.serverNow(), { user, device: deviceId!, events: manifest });
            if (!await this.verifyStoredSubmission(user, examId, clientAttemptId, deviceId!, studentAnswers,
                answerRevisions, assignmentData, frozenSubmission, true, true)) throw error;
            const { data: final } = await this.db.from('cbt_exam_attempts').select('total_score').eq('id', clientAttemptId).maybeSingle();
            result = { score: final?.total_score ?? null, alreadySubmitted: true, savedAnswersOnly: false,
                ...(final?.total_score == null ? { gradingPending: true } : {}) };
        }
        // A closed attempt alone is not an acknowledgement of this request's
        // contents. Verify persisted data even on the idempotent/retry branches.
        const submissionVerified = !result.savedAnswersOnly && Boolean(clientAttemptId) &&
            await this.verifyStoredSubmission(user, examId, clientAttemptId!, deviceId!, studentAnswers,
                answerRevisions, assignmentData, frozenSubmission, true, true);
        const { data: visibility, error } = await this.db.from('cbt_exams')
            .select('show_results, scoring_type, metadata').eq('id', examId).maybeSingle();
        return { ...result, submissionVerified, verifiedAttemptId: submissionVerified ? clientAttemptId : undefined,
            score: !error && visibility?.show_results === true && studentScoreType(visibility) === 'classical' ? result.score : null };
    }

    private async verifyStoredSubmission(
        user: AuthUser, examId: string, attemptId: string, deviceId: string,
        answers: Record<string, string>, revisions?: Record<string, number>,
        assignment?: Record<string, unknown>, frozen?: { startedAt: string; personalEndTime: string },
        allowExpiry = false, closedOnly = false,
    ): Promise<boolean> {
        return this.db.transaction(async db => {
            await db.raw('SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE', attemptId);
            const { data: attempt, error } = await db.from('cbt_exam_attempts')
                .select('user_id, exam_id, status, device_fingerprint, started_at, personal_end_time, metadata')
                .eq('id', attemptId).maybeSingle();
            if (error) throw new ServiceUnavailableException('Pengumpulan belum dapat diverifikasi. Silakan coba lagi.');
            const acceptableStatus = attempt?.status === 'submitted' || (allowExpiry &&
                ((attempt?.status === 'auto_submitted' && attempt.metadata?.closed_by_expiry === true) ||
                    (!closedOnly && attempt?.status === 'in_progress' && attempt.metadata?.recovery_submit_only !== true)));
            if (!attempt || !acceptableStatus || attempt.user_id !== user.id ||
                attempt.exam_id !== examId || (attempt.device_fingerprint && attempt.device_fingerprint !== deviceId.trim())) return false;
            if (frozen && (Date.parse(attempt.started_at || '') !== Date.parse(frozen.startedAt) ||
                ![attempt.personal_end_time, attempt.metadata?.recovery_source_deadline].some(deadline =>
                    Date.parse(deadline || '') === Date.parse(frozen.personalEndTime)))) return false;
            const { data: saved, error: readError } = await db.from('cbt_answers')
                .select('question_id, selected_option_id, essay_answer, metadata').eq('attempt_id', attemptId);
            if (readError) throw new ServiceUnavailableException('Jawaban tersimpan belum dapat diverifikasi. Silakan coba lagi.');
            type StoredAnswer = { question_id: string; essay_answer: string | null; selected_option_id: string | null;
                metadata?: { answer_revision?: number } | null };
            const byId = new Map<string, StoredAnswer>(((saved || []) as StoredAnswer[]).map(row => [row.question_id, row]));
            for (const [id, value] of Object.entries(answers)) {
                const row = byId.get(id);
                if (!row || (row.essay_answer ?? row.selected_option_id ?? '') !== value ||
                    (revisions?.[id] !== undefined && Number(row.metadata?.answer_revision ?? 0) !== revisions[id])) return false;
            }
            const canonical = (value: unknown): string => {
                if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
                if (value && typeof value === 'object') return '{' + Object.entries(value)
                    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
                    .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
                return JSON.stringify(value) ?? 'null';
            };
            return assignment === undefined || canonical(assignment) === canonical(attempt.metadata?.assignment_submission);
        });
    }

    private async submitInternal(
        user: AuthUser,
        examId: string,
        studentAnswers: Record<string, string>,
        assignmentData?: Record<string, unknown>,
        clientAttemptId?: string,
        deviceId?: string,
        answerRevisions?: Record<string, number>,
        frozenSubmission?: { startedAt: string; personalEndTime: string },
        securityEvents: SubmissionSecurityEvent[] = [],
    ) {
        const device = this.requireDeviceId(deviceId);
        const digest = submissionDigest({ answers: studentAnswers, answerRevisions, assignmentData, frozenSubmission });
        if (frozenSubmission && !clientAttemptId) throw new BadRequestException('Sesi salinan jawaban wajib diisi.');
        // Pengerjaan milik orang lain di perangkat ini: pencarian berdasarkan
        // pengguna di bawah akan berakhir "tidak ada sesi aktif", yang membingungkan.
        // Kasusnya dikenali lebih dulu supaya pesannya menyebut sebab sebenarnya.
        if (clientAttemptId) {
            const { data } = await this.db
                .from('cbt_exam_attempts')
                .select('user_id, exam_id, status, total_score, device_fingerprint, started_at')
                .eq('id', clientAttemptId)
                .maybeSingle();

            const owned = data as {
                user_id: string;
                exam_id: string;
                status: string;
                total_score: number | null;
                device_fingerprint: string | null;
                started_at: string | null;
            } | null;

            if (!owned || owned.exam_id !== examId) {
                throw new ForbiddenException('Sesi pengerjaan tidak cocok dengan ujian ini.');
            }

            if (owned && owned.user_id !== user.id) {
                throw new ForbiddenException(
                    'Sesi login di perangkat ini bukan milik Anda. Silakan logout lalu login ' +
                        'kembali dengan akun Anda sendiri sebelum mengumpulkan ujian.',
                );
            }
            if (frozenSubmission && (owned.device_fingerprint !== device ||
                Date.parse(owned.started_at || '') !== Date.parse(frozenSubmission.startedAt))) {
                throw new ForbiddenException('Salinan jawaban tidak cocok dengan sesi atau perangkat ini.');
            }
            if (owned && ['submitted', 'auto_submitted'].includes(owned.status) &&
                !(frozenSubmission && owned.status === 'auto_submitted')) {
                return {
                    score: owned.total_score ?? null,
                    alreadySubmitted: true,
                    savedAnswersOnly: owned.status === 'auto_submitted',
                    ...(owned.total_score == null ? { gradingPending: true } : {}),
                };
            }
        }

        const { data: examRow } = await this.db
            .from('cbt_exams')
            .select('organization_id, question_bank_id, exam_type, duration_minutes')
            .eq('id', examId)
            .maybeSingle();

        if (!examRow) throw new NotFoundException('Ujian tidak ditemukan.');
        const exam = examRow as { exam_type: string | null };

        const attempt = frozenSubmission && clientAttemptId
            ? { id: clientAttemptId }
            : await this.resolveAttemptForSubmit(user, examId, clientAttemptId);

        if (!attempt) {
            // Tidak ada pengerjaan aktif, tetapi mungkin sudah pernah dikumpulkan —
            // mis. penutupan otomatis menang balapan, atau panggilan sebelumnya
            // gagal setelah statusnya tersimpan.
            const { data: submitted } = await this.db
                .from('cbt_exam_attempts')
                .select('id, total_score, status')
                .eq('user_id', user.id)
                .eq('exam_id', examId)
                .in('status', ['submitted', 'auto_submitted'])
                .order('finished_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (submitted) {
                return {
                    score: submitted.total_score ?? null,
                    alreadySubmitted: true,
                    savedAnswersOnly: submitted.status === 'auto_submitted',
                    ...(submitted.total_score == null ? { gradingPending: true } : {}),
                };
            }

            throw new BadRequestException(
                'Gagal memperbarui status ujian. Pastikan Anda memiliki sesi aktif.',
            );
        }

        // Accept and durably close the attempt BEFORE calling external scoring.
        // A slow/offline scoring service must never lose a timely submission.
        let committed: { score: number | null; alreadySubmitted: boolean; savedAnswersOnly: boolean; gradingPending?: boolean; finishedAt?: string; answers?: Record<string, string> };
        try {
            committed = await this.db.transaction(async db => {
                await db.raw('SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE', attempt.id);
                const { data: current, error: readError } = await db.from('cbt_exam_attempts')
                    .select('status, total_score, metadata, user_id, device_fingerprint, started_at, personal_end_time, exam_id').eq('id', attempt.id).maybeSingle();
                if (readError || !current) throw new BadRequestException('Sesi pengerjaan tidak dapat dibaca.');
                if (['submitted', 'auto_submitted'].includes(current.status) &&
                    !(frozenSubmission && current.status === 'auto_submitted')) {
                    return {
                        score: current.total_score ?? null,
                        alreadySubmitted: true,
                        savedAnswersOnly: current.status === 'auto_submitted',
                        ...(current.total_score == null ? { gradingPending: true } : {}),
                    };
                }
                if (frozenSubmission) {
                    await this.assertFrozenSubmission(user, current, frozenSubmission, device, db, digest);
                } else {
                    if (current.metadata?.recovery_submit_only === true) throw new BadRequestException('Pemulihan memerlukan salinan jawaban terkunci.');
                    await this.assertOwnedAndRunning(user, attempt.id, db, device, true, digest);
                }
                const [intentClock] = await db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
                if (hasActiveSubmitIntent(current.metadata, new Date(intentClock.now)) &&
                    current.metadata?.submit_intent_digest && current.metadata.submit_intent_digest !== digest) {
                    throw new ConflictException('Isi pengumpulan berbeda dari kiriman yang sudah dikunci. Hubungi proktor.');
                }
                const questions = await readExamQuestionVersion(db, examId);
                const byId = new Map(questions.map(question => [question.id, question]));
                const rows: AnswerInput[] = Object.entries(studentAnswers).map(([questionId, raw]) => {
                    if (typeof raw !== 'string' || !byId.has(questionId)) {
                        throw new BadRequestException('Jawaban pengumpulan tidak sesuai dengan soal ujian.');
                    }
                    const columns = toAnswerColumns(byId.get(questionId)!.type, raw);
                    return { questionId, selected_option_id: columns.selected_option_id ?? undefined,
                        essay_answer: columns.essay_answer ?? undefined, revision: answerRevisions?.[questionId] };
                });
                await this.assertAnswersBelongToExam(examId, rows, db);
                await this.upsertAnswers(attempt.id, rows, db);
                const { data: saved, error: savedError } = await db.from('cbt_answers')
                    .select('question_id, selected_option_id, essay_answer').eq('attempt_id', attempt.id);
                if (savedError) throw new BadRequestException('Jawaban belum dapat dibaca.');
                const answers: Record<string, string> = Object.fromEntries((saved || []).map((row: any) =>
                    [row.question_id, row.essay_answer ?? row.selected_option_id ?? '']));
                const [clock] = await db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
                const finishedAt = new Date(clock.now).toISOString();
                if (securityEvents.length) {
                    const { data: bounds, error: boundsError } = await db.from('cbt_exams')
                        .select('end_time, duration_minutes').eq('id', examId).maybeSingle();
                    if (boundsError || !bounds) throw new BadRequestException('Batas waktu pengawasan belum dapat diperiksa.');
                    await persistSubmissionSecurityEvents(db, attempt.id, user.id, current, securityEvents,
                        new Date(clock.now), examDeadline(current, bounds));
                }
                const metadata: Record<string, unknown> = { ...(current.metadata || {}) };
                // Recovery transports frozen answers, not additional working time.
                const scoringEnd = current.metadata?.recovery_submit_only === true
                    ? current.metadata.scoring_finished_at || current.metadata.recovery_source_deadline
                    : current.metadata?.submit_intent_at || finishedAt;
                const scoringEndMs = Date.parse(scoringEnd || finishedAt);
                metadata.scoring_finished_at = new Date(Math.min(Date.parse(finishedAt),
                    Number.isFinite(scoringEndMs) ? scoringEndMs : Date.parse(finishedAt))).toISOString();
                if (assignmentData) metadata.assignment_submission = assignmentData;
                if (frozenSubmission) {
                    metadata.frozen_submission_received_at = finishedAt;
                    metadata.frozen_submission_deadline = frozenSubmission.personalEndTime;
                }
                const { error } = await db.from('cbt_exam_attempts').update({
                    status: 'submitted', total_score: null, finished_at: finishedAt, metadata,
                    needs_manual_grading: exam.exam_type === 'assignment' || questions.some(q => isEssayType(q.type)),
                }).eq('id', attempt.id).eq('status', current.status);
                if (error) throw new BadRequestException('Pengumpulan belum tersimpan. Silakan coba lagi.');
                return { score: null, alreadySubmitted: false, savedAnswersOnly: false,
                    gradingPending: true, finishedAt, answers };
            });
        } catch (error) {
            if (error instanceof ForbiddenException &&
                (error.getResponse() as { code?: string }).code === 'EXAM_TIME_EXPIRED') {
                await this.autoFinish(attempt.id, await this.serverNow(), { user, device, events: securityEvents });
                const { data: final } = await this.db.from('cbt_exam_attempts')
                    .select('total_score').eq('id', attempt.id).maybeSingle();
                return {
                    score: final?.total_score ?? null,
                    alreadySubmitted: true,
                    savedAnswersOnly: true,
                    ...(final?.total_score == null ? { gradingPending: true } : {}),
                };
            }
            throw error;
        }
        if (!committed.alreadySubmitted) {
            try {
                const graded = await this.gradeSubmission(examId, committed.answers!);
                await this.db.transaction(async db => {
                    await advisoryTransactionLock(db, `exam-key-correction:${examId}`);
                    if (JSON.stringify(await readExamQuestionVersion(db, examId)) !== JSON.stringify(graded.questions)) {
                        throw new BadRequestException('Soal atau kunci diperbarui. Penilaian akan diulang otomatis.');
                    }
                    await db.raw('SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE', attempt.id);
                    const { data: current, error } = await db.from('cbt_exam_attempts')
                        .select('status, finished_at, metadata, total_score').eq('id', attempt.id).maybeSingle();
                    if (error) throw new BadRequestException('Hasil penilaian belum dapat disimpan.');
                    // A proctor reset must invalidate results from the old submission.
                    if (!current || current.status !== 'submitted' || current.finished_at !== committed.finishedAt) return;
                    // A background retry may already have committed the grade (and a teacher
                    // may subsequently have graded essays). Never overwrite that result.
                    if (current.total_score != null) {
                        committed.score = current.total_score;
                        committed.gradingPending = false;
                        return;
                    }
                    await this.persistAnswers(attempt.id, graded.rows, db);
                    const { error: updateError } = await db.from('cbt_exam_attempts').update({
                        total_score: graded.scaledScore,
                        needs_manual_grading: graded.needsManualGrading || exam.exam_type === 'assignment',
                        metadata: { ...(current.metadata || {}), dimension_scores: graded.dimensionScores,
                            base_score: graded.scaledScore, relative_scoring_pending: exam.exam_type === 'quiz' },
                    }).eq('id', attempt.id);
                    if (updateError) throw new BadRequestException('Hasil penilaian belum dapat disimpan.');
                    committed.score = graded.scaledScore;
                    committed.gradingPending = false;
                });
                if (!committed.gradingPending && exam.exam_type === 'quiz') {
                    const relative = await this.grading.applyRelativeQuizScoring(examId);
                    if (relative[attempt.id] !== undefined) committed.score = relative[attempt.id];
                }
            } catch (error) {
                this.logger.error(`Jawaban sudah dikumpulkan; penilaian tertunda: ${(error as Error).message}`);
            }
        }
        return {
            score: committed.score,
            alreadySubmitted: committed.alreadySubmitted,
            savedAnswersOnly: committed.savedAnswersOnly,
            ...(committed.gradingPending ? { gradingPending: true } : {}),
        };
    }

    /**
     * Nilai jawaban yang dikirim klien, dan siapkan baris `cbt_answers`-nya.
     *
     * Perhitungannya di FastAPI. Soal esai ditangani di sini karena FastAPI
     * sengaja melewatinya — ia hanya menandai `needs_manual_grading` — padahal
     * barisnya tetap harus ada supaya guru punya sesuatu untuk dinilai.
     */
    private async gradeSubmission(examId: string, studentAnswers: Record<string, string>) {
        const empty = {
            questions: [] as Awaited<ReturnType<typeof loadFrozenExamQuestions>>,
            scaledScore: 0,
            dimensionScores: {} as Record<string, number>,
            needsManualGrading: false,
            rows: [] as AnswerRow[],
        };

        const questions = await loadFrozenExamQuestions(this.db, examId);
        if (questions.length === 0) return empty;

        const result = await this.scoring.post<{
            items: Array<{
                answer_id: string | null;
                score: number;
                is_correct: boolean | null;
                dimension_scores: Record<string, number>;
            }>;
            scaled_score: number;
            needs_manual_grading: boolean;
            dimension_scores: Record<string, number>;
        }>('/grading/attempt', {
            items: questions.map((question) => ({
                question,
                answer_id: question.id,
                raw_answer: studentAnswers[question.id] ?? null,
            })),
        });

        const scored = new Map(result.items.map((item) => [item.answer_id, item]));
        const rows: AnswerRow[] = [];

        for (const question of questions) {
            const rawAnswer = studentAnswers[question.id];
            const essay = isEssayType(question.type);

            // Soal tanpa jawaban tidak menghasilkan baris — kecuali esai, yang
            // barisnya tetap dibuat agar muncul di antrean penilaian guru.
            if (!rawAnswer && !essay) continue;

            const item = scored.get(question.id);

            rows.push({
                question_id: question.id,
                ...toAnswerColumns(question.type, rawAnswer),
                score: essay ? 0 : (item?.score ?? 0),
                is_correct: essay ? null : (item?.is_correct ?? null),
            });
        }

        return {
            questions,
            scaledScore: result.scaled_score,
            dimensionScores: result.dimension_scores || {},
            needsManualGrading: result.needs_manual_grading,
            rows,
        };
    }

    /**
     * Tulis jawaban dengan UPSERT, bukan UPDATE.
     *
     * Kalau autosave sempat gagal karena jaringan, barisnya belum ada — dan
     * UPDATE pada baris yang tidak ada gagal diam-diam, yang muncul ke siswa
     * sebagai "jawaban tidak terekam" setelah ujian selesai.
     */
    private async persistAnswers(attemptId: string, rows: AnswerRow[], db: DbSession = this.db): Promise<void> {
        if (rows.length === 0) return;

        const { error } = await db.from('cbt_answers').upsert(
            rows.map((row) => ({ attempt_id: attemptId, ...row })),
            { onConflict: 'attempt_id, question_id' },
        );

        if (error) {
            throw new BadRequestException('Jawaban belum tersimpan. Silakan coba mengumpulkan lagi.');
        }
    }

    /**
     * Pengerjaan mana yang dikumpulkan.
     *
     * `clientAttemptId` didahulukan supaya submit selalu mengenai baris yang
     * benar-benar dikerjakan, bahkan bila ada lebih dari satu baris
     * `in_progress` dari data lama sebelum pengaman tahap 15 diterapkan.
     */
    private async resolveAttemptForSubmit(
        user: AuthUser,
        examId: string,
        clientAttemptId?: string,
    ): Promise<{ id: string; metadata: Record<string, unknown> | null } | null> {
        if (clientAttemptId) {
            const { data } = await this.db
                .from('cbt_exam_attempts')
                .select('id, metadata, user_id, exam_id, status')
                .eq('id', clientAttemptId)
                .maybeSingle();

            const attempt = data as any;
            if (!attempt || attempt.user_id !== user.id || attempt.exam_id !== examId) {
                throw new ForbiddenException('Sesi pengerjaan tidak cocok dengan ujian ini.');
            }
            if (attempt && attempt.user_id === user.id && attempt.status === 'in_progress') {
                return { id: attempt.id, metadata: attempt.metadata };
            }
            return null;
        }

        // `order` + `limit`, bukan `maybeSingle`: duplikat legacy tidak boleh
        // melempar galat justru di saat siswa mengumpulkan ujian.
        const { data: rows } = await this.db
            .from('cbt_exam_attempts')
            .select('id, metadata')
            .eq('user_id', user.id)
            .eq('exam_id', examId)
            .eq('status', 'in_progress')
            .order('started_at', { ascending: false })
            .limit(1);

        return ((rows as any[]) || [])[0] ?? null;
    }

    // ── Pembantu ─────────────────────────────────────────────────────────────

    /**
     * Jam basis data, bukan jam proses NestJS maupun jam perangkat siswa.
     *
     * Semua batas waktu ujian diukur terhadap acuan ini, jadi ia harus datang
     * dari satu tempat yang sama dengan tempat data ujiannya disimpan.
     */
    private async serverNow(): Promise<Date> {
        try {
            const rows = await this.db.raw<Array<{ now: Date }>>('SELECT NOW() AS now');
            const now = rows?.[0]?.now;
            if (now) return new Date(now);
        } catch (err) {
            this.logger.error(`Gagal membaca waktu server: ${(err as Error).message}`);
        }
        return new Date();
    }

    private requireDeviceId(deviceId?: string): string {
        const device = typeof deviceId === 'string' ? deviceId.trim() : '';
        if (device.length < 8 || device.length > 200) {
            throw new BadRequestException('Identitas perangkat tidak valid. Muat ulang halaman ujian.');
        }
        return device;
    }

    /**
     * Penolakan yang BUKAN galat HTTP.
     *
     * "Ujian belum dimulai" dan "waktu sudah habis" adalah keadaan normal yang
     * layarnya tangani sendiri, kadang dengan membawa `expiredAttemptId` untuk
     * menyusulkan jawaban yang hanya sempat tersimpan di perangkat.
     *
     * Penandanya `started`, BUKAN `success`. Bungkus balasan milik route handler
     * memperlakukan `success: false` sebagai kegagalan permintaan dan hanya
     * meneruskan pesan galatnya — `expiredAttemptId` akan ikut terbuang di jalan,
     * dan jawaban yang tertinggal itu hilang tanpa jejak.
     */
    private refuse(error: string, extra: Record<string, unknown> = {}) {
        return { started: false as const, error, ...extra };
    }

}

interface AnswerRow {
    question_id: string;
    selected_option_id: string | null;
    essay_answer: string | null;
    score: number;
    is_correct: boolean | null;
}

// Dipakai `toAnswerColumns`; diekspor ulang di sini supaya jalur submit dan
// jalur susulan jawaban jelas memakai aturan kolom yang sama.
export { usesTextColumn };
