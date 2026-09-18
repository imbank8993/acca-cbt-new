import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { isEssayType, toAnswerColumns, usesTextColumn } from '../common/answer-storage';
import {
    orderQuestionsForStudent,
    shuffleOptionsForStudent,
} from '../common/question-order';
import { utcToWibClock } from '../common/wib-time';
import { GradingService } from '../grading/grading.service';
import { DbService } from '../prisma/prisma-db-adapter';
import { ScoringClient } from '../scoring/scoring.client';

/** Susulan jawaban hanya diterima dalam jendela ini sejak attempt ditutup sistem. */
const LATE_SYNC_WINDOW_MS = 6 * 60 * 60 * 1000;

/** Durasi bawaan bila ujian tidak menyimpannya. */
const DEFAULT_DURATION_MINUTES = 60;

export interface AnswerInput {
    questionId: string;
    selected_option_id?: string;
    essay_answer?: string;
    is_doubtful?: boolean;
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
    ) {}

    // ── Soal ─────────────────────────────────────────────────────────────────

    /**
     * Soal dan opsi untuk halaman ujian.
     *
     * `is_correct` sengaja TIDAK ikut dipilih: kunci jawaban tidak boleh pernah
     * sampai ke browser siswa, dan satu-satunya cara memastikannya adalah tidak
     * mengambilnya sama sekali dari basis data.
     */
    async getQuestions(user: AuthUser, examId: string) {
        const { data: exam } = await this.db
            .from('cbt_exams')
            .select(
                'id, question_bank_id, is_published, exam_type, randomize_questions, randomize_options',
            )
            .eq('id', examId)
            .maybeSingle();

        if (!exam) throw new NotFoundException('Ujian tidak ditemukan.');

        const row = exam as {
            question_bank_id: string | null;
            is_published: boolean;
            randomize_questions: boolean | null;
            randomize_options: boolean | null;
        };

        if (!row.is_published) {
            throw new ForbiddenException('Ujian belum dipublikasikan oleh proktor.');
        }
        if (!row.question_bank_id) return { questions: [] };

        const { data, error } = await this.db
            .from('cbt_bank_questions')
            .select(
                `id, question_text, type, score_default, metadata, created_at,
                 bank_question_options:cbt_bank_question_options(id, option_text, weight, metadata, order),
                 stimulus:cbt_question_stimuli(*),
                 instruction:cbt_question_instructions(*)`,
            )
            .eq('bank_id', row.question_bank_id)
            .order('created_at', { ascending: true });

        if (error) throw new BadRequestException(error.message);

        // Urutan soal diambil dari `common/question-order`, bukan disalin ulang:
        // layar review hasil memakai fungsi yang sama, dan begitu keduanya
        // berbeda satu langkah saja, "soal nomor 7" di review berhenti merujuk
        // soal yang benar-benar dikerjakan siswa.
        const ordered = orderQuestionsForStudent((data as any[]) || [], {
            userId: user.id,
            examId,
            randomize: row.randomize_questions,
        });

        return {
            questions: shuffleOptionsForStudent(ordered, {
                userId: user.id,
                examId,
                randomize: row.randomize_options,
            }),
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
    async start(user: AuthUser, examId: string, deviceId?: string) {
        const now = await this.serverNow();
        const device = (deviceId || '').trim();

        const { data: exam } = await this.db
            .from('cbt_exams')
            .select(
                'organization_id, question_bank_id, is_published, start_time, end_time, duration_minutes, status, metadata',
            )
            .eq('id', examId)
            .maybeSingle();

        if (!exam) throw new NotFoundException('Ujian tidak ditemukan.');

        const row = exam as {
            organization_id: string;
            is_published: boolean;
            start_time: string | null;
            end_time: string | null;
            duration_minutes: number | null;
        };

        if (!row.is_published) {
            return this.refuse('Ujian belum dipublikasikan oleh proktor.');
        }

        if (row.start_time && now < new Date(row.start_time)) {
            return this.refuse(
                `Ujian belum dimulai. Window dibuka pk ${utcToWibClock(row.start_time)} WIB.`,
            );
        }

        if (row.end_time && now > new Date(row.end_time)) {
            const { data: anyAttempt } = await this.db
                .from('cbt_exam_attempts')
                .select('id')
                .eq('user_id', user.id)
                .eq('exam_id', examId)
                .maybeSingle();

            return this.refuse('Waktu ujian telah berakhir.', {
                expiredAttemptId: (anyAttempt as { id: string } | null)?.id,
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

        const { data: existing } = await this.db
            .from('cbt_exam_attempts')
            .select('*')
            .eq('user_id', user.id)
            .eq('exam_id', examId)
            .eq('status', 'in_progress')
            .maybeSingle();

        if (existing) return this.resume(existing as any, row, now, device);

        return this.createAttempt(user, examId, row, now, device);
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

        if (now >= personalEnd) {
            await this.autoFinish(attempt.id, now);
            // `expiredAttemptId` dikembalikan supaya klien masih bisa menyusulkan
            // jawaban yang hanya sempat tersimpan di localStorage — tanpa itu,
            // pengerjaan dinilai dari jawaban server saja dan jawaban offline
            // hilang tanpa jejak.
            return this.refuse('Waktu ujian telah berakhir.', {
                expiredAttemptId: attempt.id,
            });
        }

        const { data: answers } = await this.db
            .from('cbt_answers')
            .select('question_id, selected_option_id, essay_answer, is_doubtful')
            .eq('attempt_id', attempt.id);

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
    ) {
        const personalEnd = this.capToWindow(
            new Date(
                now.getTime() +
                    (exam.duration_minutes || DEFAULT_DURATION_MINUTES) * 60 * 1000,
            ),
            exam.end_time,
        );

        const { data: attempt, error } = await this.db
            .from('cbt_exam_attempts')
            .insert({
                organization_id: exam.organization_id,
                exam_id: examId,
                user_id: user.id,
                status: 'in_progress',
                started_at: now.toISOString(),
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
        attempt: { personal_end_time: string | null; started_at: string | null },
        exam: { end_time: string | null; duration_minutes: number | null },
        now: Date,
    ): Date {
        if (attempt.personal_end_time) return new Date(attempt.personal_end_time);

        const startedAt = attempt.started_at ? new Date(attempt.started_at) : now;
        const duration = exam.duration_minutes || DEFAULT_DURATION_MINUTES;

        return this.capToWindow(
            new Date(startedAt.getTime() + duration * 60 * 1000),
            exam.end_time,
        );
    }

    /** Batas pribadi tidak pernah melewati penutupan jendela ujian. */
    private capToWindow(personalEnd: Date, windowEnd: string | null): Date {
        if (!windowEnd) return personalEnd;
        const close = new Date(windowEnd);
        return close < personalEnd ? close : personalEnd;
    }

    /**
     * Tutup pengerjaan yang kehabisan waktu, DAN nilai dari jawaban tersimpan.
     *
     * Penilaiannya wajib: jalur ini tidak melewati submit normal, dan sebelum ada
     * ini pengerjaan semacam itu ditandai `auto_submitted` tanpa pernah punya
     * skor — seluruh `is_correct`-nya null.
     */
    private async autoFinish(attemptId: string, now: Date): Promise<void> {
        await this.db
            .from('cbt_exam_attempts')
            .update({ status: 'auto_submitted', finished_at: now.toISOString() })
            .eq('id', attemptId);

        try {
            const graded = await this.grading.gradeAttemptFromSavedAnswers(attemptId);
            if (graded) {
                await this.db
                    .from('cbt_exam_attempts')
                    .update({
                        total_score: graded.finalScore100,
                        needs_manual_grading: graded.hasEssay,
                    })
                    .eq('id', attemptId);
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

    async saveAnswer(user: AuthUser, attemptId: string, answer: AnswerInput) {
        await this.assertOwnedAndRunning(user, attemptId);
        await this.upsertAnswers(attemptId, [answer]);
        return { attemptId };
    }

    async syncAnswers(user: AuthUser, attemptId: string, answers: AnswerInput[]) {
        if (answers.length === 0) return { attemptId, saved: 0 };

        await this.assertOwnedAndRunning(user, attemptId);
        await this.upsertAnswers(attemptId, answers);

        return { attemptId, saved: answers.length };
    }

    private async upsertAnswers(attemptId: string, answers: AnswerInput[]): Promise<void> {
        const { error } = await this.db.from('cbt_answers').upsert(
            answers.map((answer) => ({
                attempt_id: attemptId,
                question_id: answer.questionId,
                selected_option_id: answer.selected_option_id || null,
                essay_answer: answer.essay_answer || null,
                is_doubtful: answer.is_doubtful ?? false,
            })),
            { onConflict: 'attempt_id, question_id' },
        );

        if (error) throw new BadRequestException(error.message);
    }

    /**
     * Pemilik pengerjaan, dan pengerjaannya masih berjalan.
     *
     * Menjaga seluruh jalur penulisan jawaban: tanpa ini, siswa bisa menimpa
     * jawaban siswa lain — atau menyunting pengerjaan yang sudah dikumpulkan —
     * hanya dengan menukar `attemptId`.
     */
    private async assertOwnedAndRunning(user: AuthUser, attemptId: string): Promise<void> {
        const { data } = await this.db
            .from('cbt_exam_attempts')
            .select('user_id, status')
            .eq('id', attemptId)
            .maybeSingle();

        const attempt = data as { user_id: string; status: string } | null;

        if (!attempt || attempt.user_id !== user.id) {
            throw new ForbiddenException('Tidak diizinkan.');
        }
        if (attempt.status !== 'in_progress') {
            throw new ForbiddenException('Ujian tidak sedang berlangsung.');
        }
    }

    // ── Susulan jawaban ──────────────────────────────────────────────────────

    /**
     * Susulkan jawaban yang tertinggal di localStorage untuk pengerjaan yang
     * SUDAH ditutup otomatis sistem.
     *
     * Kejadiannya: siswa kehilangan jaringan, jawabannya hanya tersimpan lokal,
     * waktunya habis, tabnya tertutup. Saat dibuka lagi, `start` menilai dari
     * jawaban server saja dan jawaban lokal itu tidak pernah tersusul — jalur
     * sinkronisasi biasa menolaknya karena pengerjaannya bukan `in_progress`.
     *
     * Pagarnya: hanya pemilik, hanya dari perangkat yang sama, hanya status
     * `auto_submitted`, hanya dalam enam jam sejak ditutup, dan hanya mengisi
     * jawaban yang kosong atau tersimpan sebagian. Esai tidak pernah ditimpa
     * karena mungkin sudah dinilai guru.
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

        const device = (deviceId || '').trim();
        if (attempt.device_fingerprint && device && attempt.device_fingerprint !== device) {
            throw new ForbiddenException(
                'Susulan jawaban hanya bisa dari perangkat yang dipakai mengerjakan.',
            );
        }
        if (
            attempt.finished_at &&
            Date.now() - new Date(attempt.finished_at).getTime() > LATE_SYNC_WINDOW_MS
        ) {
            throw new ForbiddenException('Batas waktu susulan jawaban telah lewat.');
        }

        const [{ data: stored }, questionTypes] = await Promise.all([
            this.db
                .from('cbt_answers')
                .select('question_id, selected_option_id, essay_answer')
                .eq('attempt_id', attemptId),
            this.loadQuestionTypes(attempt.exam_id),
        ]);

        const byQuestion = new Map<string, any>(
            ((stored as any[]) || []).map((r) => [r.question_id, r]),
        );

        const payload = answers
            .filter((answer) => {
                const existing = byQuestion.get(answer.questionId);
                const storedScore = existing
                    ? completeness(existing.essay_answer ?? existing.selected_option_id)
                    : 0;

                // Belum ada atau masih kosong: selalu boleh diisi.
                if (storedScore === 0) return true;
                // Esai mungkin sudah dinilai guru.
                if (isEssayType(questionTypes.get(answer.questionId))) return false;
                // Sisanya hanya menang bila salinan lokalnya memang lebih lengkap.
                return (
                    completeness(answer.essay_answer ?? answer.selected_option_id) > storedScore
                );
            })
            .map((answer) => ({
                attempt_id: attemptId,
                question_id: answer.questionId,
                selected_option_id: answer.selected_option_id || null,
                essay_answer: answer.essay_answer || null,
                is_doubtful: answer.is_doubtful ?? false,
            }))
            .filter((row) => row.selected_option_id !== null || row.essay_answer !== null);

        if (payload.length === 0) return { restored: 0 };

        const { error } = await this.db
            .from('cbt_answers')
            .upsert(payload, { onConflict: 'attempt_id, question_id' });

        if (error) throw new BadRequestException(error.message);

        const graded = await this.grading.gradeAttemptFromSavedAnswers(attemptId);
        if (graded) {
            await this.db
                .from('cbt_exam_attempts')
                .update({
                    total_score: graded.finalScore100,
                    needs_manual_grading: graded.hasEssay,
                })
                .eq('id', attemptId);
        }

        await this.db.from('cbt_attempt_security_logs').insert({
            attempt_id: attemptId,
            event_type: 'LATE_ANSWER_SYNC',
            metadata: { restored_count: payload.length, at: new Date().toISOString() },
        });

        return { restored: payload.length };
    }

    private async loadQuestionTypes(examId: string): Promise<Map<string, string>> {
        const bankId = await this.resolveBankId(examId);
        if (!bankId) return new Map();

        const { data } = await this.db
            .from('cbt_bank_questions')
            .select('id, type')
            .eq('bank_id', bankId);

        return new Map(
            ((data as Array<{ id: string; type: string }>) || []).map((q) => [q.id, q.type]),
        );
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
        user: AuthUser,
        examId: string,
        studentAnswers: Record<string, string>,
        assignmentData?: Record<string, unknown>,
        clientAttemptId?: string,
    ) {
        // Pengerjaan milik orang lain di perangkat ini: pencarian berdasarkan
        // pengguna di bawah akan berakhir "tidak ada sesi aktif", yang membingungkan.
        // Kasusnya dikenali lebih dulu supaya pesannya menyebut sebab sebenarnya.
        if (clientAttemptId) {
            const { data } = await this.db
                .from('cbt_exam_attempts')
                .select('user_id, status, total_score')
                .eq('id', clientAttemptId)
                .maybeSingle();

            const owned = data as {
                user_id: string;
                status: string;
                total_score: number | null;
            } | null;

            if (owned && owned.user_id !== user.id) {
                throw new ForbiddenException(
                    'Sesi login di perangkat ini bukan milik Anda. Silakan logout lalu login ' +
                        'kembali dengan akun Anda sendiri sebelum mengumpulkan ujian.',
                );
            }
            if (owned && ['submitted', 'auto_submitted'].includes(owned.status)) {
                return {
                    score: owned.total_score ?? 0,
                    alreadySubmitted: true,
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

        const graded = await this.gradeSubmission(examId, studentAnswers);

        // Tugas (assignment) selalu butuh penilaian manual, bahkan tanpa soal esai.
        const needsManualGrading =
            graded.needsManualGrading || exam.exam_type === 'assignment';

        const attempt = await this.resolveAttemptForSubmit(user, examId, clientAttemptId);

        if (!attempt) {
            // Tidak ada pengerjaan aktif, tetapi mungkin sudah pernah dikumpulkan —
            // mis. penutupan otomatis menang balapan, atau panggilan sebelumnya
            // gagal setelah statusnya tersimpan.
            const { data: submitted } = await this.db
                .from('cbt_exam_attempts')
                .select('id, total_score')
                .eq('user_id', user.id)
                .eq('exam_id', examId)
                .in('status', ['submitted', 'auto_submitted'])
                .order('finished_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (submitted) {
                return {
                    score: (submitted as { total_score: number | null }).total_score ?? 0,
                    alreadySubmitted: true,
                };
            }

            throw new BadRequestException(
                'Gagal memperbarui status ujian. Pastikan Anda memiliki sesi aktif.',
            );
        }

        const finishedAt = new Date();

        // Kolom KRITIS (status dan skor) ditulis TANPA `metadata`, supaya basis
        // data yang belum punya kolom metadata tidak bisa menggagalkan seluruh
        // pengumpulan. Ujian harus tercatat terkumpul; metadata menyusul di
        // bawah sebagai usaha terbaik.
        //
        // Penyaringan `.eq('status', 'in_progress')` sekaligus jadi penjaga
        // submit ganda: pemanggilan kedua tidak menemukan baris untuk diubah.
        const { data: updated } = await this.db
            .from('cbt_exam_attempts')
            .update({
                status: 'submitted',
                needs_manual_grading: needsManualGrading,
                finished_at: finishedAt.toISOString(),
                total_score: graded.scaledScore,
            })
            .eq('id', attempt.id)
            .eq('status', 'in_progress')
            .select('id')
            .maybeSingle();

        if (!updated) {
            const { data: postCheck } = await this.db
                .from('cbt_exam_attempts')
                .select('id, total_score, status')
                .eq('id', attempt.id)
                .maybeSingle();

            const row = postCheck as { total_score: number | null; status: string } | null;
            if (row && ['submitted', 'auto_submitted'].includes(row.status)) {
                return { score: row.total_score ?? graded.scaledScore, alreadySubmitted: true };
            }

            throw new BadRequestException(
                'Gagal memperbarui status ujian. Pastikan Anda memiliki sesi aktif.',
            );
        }

        const metadata: Record<string, unknown> = {
            ...(attempt.metadata || {}),
            dimension_scores: graded.dimensionScores,
            base_score: graded.scaledScore,
        };
        if (assignmentData) metadata.assignment_submission = assignmentData;

        const { error: metadataError } = await this.db
            .from('cbt_exam_attempts')
            .update({ metadata })
            .eq('id', attempt.id);

        if (metadataError) {
            this.logger.warn(`Metadata pengerjaan tidak tersimpan: ${metadataError.message}`);
        }

        // ── Setelah pengerjaan TERCATAT terkumpul ────────────────────────────
        // Semua di bawah ini penyempurnaan. Kegagalannya tidak boleh dikembalikan
        // sebagai galat: klien akan mencoba ulang pada pengerjaan yang statusnya
        // sudah bukan `in_progress`, dan siswa melihat ujiannya seolah gagal
        // terkumpul padahal sudah tersimpan.
        let score = graded.scaledScore;

        try {
            await this.persistAnswers(attempt.id, graded.rows);

            if (exam.exam_type === 'quiz') {
                const relative = await this.grading.applyRelativeQuizScoring(examId);
                if (relative[attempt.id] !== undefined) score = relative[attempt.id];
            }
        } catch (err) {
            this.logger.error(
                `Pengolahan lanjutan gagal untuk pengerjaan ${attempt.id} ` +
                    `(statusnya sudah tersimpan sebagai terkumpul): ${(err as Error).message}`,
            );
        }

        return { score };
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
            scaledScore: 0,
            dimensionScores: {} as Record<string, number>,
            needsManualGrading: false,
            rows: [] as AnswerRow[],
        };

        const bankId = await this.resolveBankId(examId);
        if (!bankId) return empty;

        const { data, error } = await this.db
            .from('cbt_bank_questions')
            .select(
                `id, type, score_default, metadata, dimension_id,
                 bank_question_options:cbt_bank_question_options(id, option_text, is_correct, weight, order, metadata)`,
            )
            .eq('bank_id', bankId);

        if (error) throw new BadRequestException('Gagal memuat soal untuk penilaian.');

        const questions = (data as any[]) || [];

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
    private async persistAnswers(attemptId: string, rows: AnswerRow[]): Promise<void> {
        if (rows.length === 0) return;

        const { error } = await this.db.from('cbt_answers').upsert(
            rows.map((row) => ({ attempt_id: attemptId, ...row })),
            { onConflict: 'attempt_id, question_id' },
        );

        if (error) {
            this.logger.error(`Gagal menyimpan jawaban pengerjaan ${attemptId}: ${error.message}`);
        }
    }

    /**
     * Pengerjaan mana yang dikumpulkan.
     *
     * `clientAttemptId` didahulukan supaya submit selalu mengenai baris yang
     * benar-benar dikerjakan, bahkan bila ada lebih dari satu baris
     * `in_progress` — yang bisa terjadi akibat balapan saat memulai.
     */
    private async resolveAttemptForSubmit(
        user: AuthUser,
        examId: string,
        clientAttemptId?: string,
    ): Promise<{ id: string; metadata: Record<string, unknown> | null } | null> {
        if (clientAttemptId) {
            const { data } = await this.db
                .from('cbt_exam_attempts')
                .select('id, metadata, user_id, status')
                .eq('id', clientAttemptId)
                .maybeSingle();

            const attempt = data as any;
            if (attempt && attempt.user_id === user.id && attempt.status === 'in_progress') {
                return { id: attempt.id, metadata: attempt.metadata };
            }
        }

        // `order` + `limit`, bukan `maybeSingle`: baris `in_progress` ganda tidak
        // boleh melempar galat justru di saat siswa mengumpulkan ujian.
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

    private async resolveBankId(examId: string): Promise<string | null> {
        const { data: exam } = await this.db
            .from('cbt_exams')
            .select('question_bank_id')
            .eq('id', examId)
            .maybeSingle();

        const direct = (exam as { question_bank_id: string | null } | null)?.question_bank_id;
        if (direct) return direct;

        const { data: sources } = await this.db
            .from('cbt_exam_question_sources')
            .select('bank_id')
            .eq('exam_id', examId)
            .limit(1);

        return ((sources as Array<{ bank_id: string }>) || [])[0]?.bank_id ?? null;
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

/**
 * Seberapa "penuh" sebuah jawaban tersimpan, dihitung dari bentuk datanya.
 *
 * Jawaban majemuk — PGK, benar/salah, menjodohkan, kategorisasi, isian — bisa
 * berakhir tersimpan SEBAGIAN kalau autosave terakhir gagal: siswa mencentang
 * tiga opsi tetapi hanya dua yang sampai ke server. Aturan lama "jangan timpa
 * baris yang sudah terisi" membuat keadaan itu mustahil diperbaiki; dengan ukuran
 * ini, salinan lokal boleh menang bila jelas lebih lengkap.
 */
function completeness(raw: string | null | undefined): number {
    if (raw === null || raw === undefined) return 0;

    const text = String(raw).trim();
    if (text === '') return 0;

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        // Bukan JSON: satu nilai tunggal yang tidak kosong.
        return 1;
    }

    if (Array.isArray(parsed)) {
        return parsed.filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
            .length;
    }

    if (parsed && typeof parsed === 'object') {
        return Object.values(parsed as Record<string, unknown>).filter((v) =>
            Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && String(v).trim() !== '',
        ).length;
    }

    return String(parsed).trim() === '' ? 0 : 1;
}

// Dipakai `toAnswerColumns`; diekspor ulang di sini supaya jalur submit dan
// jalur susulan jawaban jelas memakai aturan kolom yang sama.
export { usesTextColumn };
