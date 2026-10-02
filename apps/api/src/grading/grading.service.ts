import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthorizationService } from '../auth/authorization.service';
import {
    hasExamQuestionSnapshots,
    loadFrozenExamQuestions,
} from '../common/exam-question-snapshots';
import { DbService } from '../prisma/prisma-db-adapter';
import { ScoringClient } from '../scoring/scoring.client';

/** Status attempt yang dianggap selesai dan ikut dihitung. */
const FINISHED_STATUSES = ['submitted', 'auto_submitted'];

interface AnswerRow {
    id: string;
    question_id: string;
    selected_option_id: string | null;
    essay_answer: string | null;
    score?: number | null;
    is_correct?: boolean | null;
}

function manualGradeSummary(questions: Array<{ id: string; type: string }>, answers: Map<string, AnswerRow>) {
    let score = 0;
    let pending = false;
    for (const question of questions) {
        if (!['essay', 'esay', 'uraian'].includes(question.type.toLowerCase())) continue;
        const answer = answers.get(question.id);
        if (typeof answer?.score === 'number' && Number.isFinite(answer.score) &&
            typeof answer.is_correct === 'boolean') score += answer.score;
        else pending = true;
    }
    return { score, pending };
}

interface AttemptTimingRow {
    id: string;
    metadata: { base_score?: number } | null;
    started_at: string | null;
    finished_at: string | null;
}

/** Balasan `/grading/attempt` dari FastAPI. */
interface GradeBatchResponse {
    items: Array<{
        answer_id: string | null;
        question_id: string;
        score: number;
        is_correct: boolean | null;
        dimension_scores: Record<string, number>;
    }>;
    total_score: number;
    max_possible_score: number;
    scaled_score: number;
    needs_manual_grading: boolean;
    dimension_scores: Record<string, number>;
}

interface IrtAttemptScore {
    id: string;
    detailed_scores: Record<string, number>;
    score_irt: number;
}

/**
 * Penilaian lanjutan (IRT). Perhitungannya ada di FastAPI; modul ini yang
 * mengambil data, menegakkan otorisasi, dan menulis hasilnya kembali.
 *
 * Dipindahkan dari `apps/web/app/actions/irt.ts`, yang tidak memeriksa apa pun —
 * `calculateExamIRT(examId, orgId)` menerima keduanya dari browser, sehingga
 * siapa pun bisa memicu perhitungan berat pada ujian mana pun.
 */
@Injectable()
export class GradingService {
    private readonly logger = new Logger(GradingService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
        private readonly scoring: ScoringClient,
    ) {}

    /**
     * Nilai satu attempt dari jawaban yang TERSIMPAN di `cbt_answers`, bukan dari
     * keadaan di klien.
     *
     * Dipakai setiap jalur yang menutup attempt tanpa submit normal — terminasi
     * pelanggaran, kedaluwarsa saat resume, dan auto-finish. Sebelum ada ini,
     * attempt semacam itu ditandai `auto_submitted` TANPA dinilai sama sekali:
     * `total_score` kosong dan seluruh `is_correct` tetap null.
     *
     * Tidak memeriksa otorisasi — ia dipanggil dari service lain yang sudah
     * memeriksanya lebih dulu, bukan langsung dari controller.
     */
    async gradeAttemptFromSavedAnswers(
        attemptId: string,
    ): Promise<{ finalScore100: number; hasEssay: boolean; examId: string; dimensionScores?: Record<string, number> } | null> {
        const { data: attempt } = await this.db
            .from('cbt_exam_attempts')
            .select('id, exam_id, status, finished_at, started_at')
            .eq('id', attemptId)
            .maybeSingle();
        if (!attempt) return null;

        const examId = (attempt as { exam_id: string }).exam_id;

        const [questions, { data: saved, error: savedError }] = await Promise.all([
            loadFrozenExamQuestions(this.db, examId),
            this.db
                .from('cbt_answers')
                .select('id, question_id, selected_option_id, essay_answer, score, is_correct')
                .eq('attempt_id', attemptId),
        ]);
        if (savedError) throw new InternalServerErrorException('Jawaban belum dapat dibaca untuk penilaian.');

        const answers = new Map<string, AnswerRow>(
            ((saved as any[]) || []).map((a) => [a.question_id, a]),
        );

        // Konvensi penyimpanan: jawaban tipe kompleks ada di `essay_answer`,
        // pilihan ganda tunggal di `selected_option_id`.
        const items = ((questions as any[]) || []).map((question) => {
            const row = answers.get(question.id);
            return {
                question,
                answer_id: question.id,
                raw_answer: row?.essay_answer ?? row?.selected_option_id ?? null,
            };
        });

        const result = await this.scoring.post<GradeBatchResponse>('/grading/attempt', { items });
        const manual = manualGradeSummary(questions || [], answers);

        // Discard results if a reset changed the attempt while scoring was running.
        const applied = await this.db.transaction(async db => {
            await db.raw('SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE', attemptId);
            const { data: current, error } = await db.from('cbt_exam_attempts')
                .select('status, finished_at, started_at').eq('id', attemptId).maybeSingle();
            if (error) throw new InternalServerErrorException('Status penilaian belum dapat dibaca.');
            if (!current || current.status !== attempt.status || current.finished_at !== attempt.finished_at ||
                current.started_at !== attempt.started_at) return false;
            for (const item of result.items) {
                if (!item.answer_id || !answers.has(item.answer_id)) continue;
                const { error: writeError } = await db.from('cbt_answers')
                    .update({ score: item.score, is_correct: item.is_correct })
                    .eq('attempt_id', attemptId).eq('question_id', item.answer_id);
                if (writeError) throw new InternalServerErrorException('Nilai jawaban belum tersimpan.');
            }
            return true;
        });
        if (!applied) return null;
        const { data: exam } = await this.db.from('cbt_exams').select('exam_type').eq('id', examId).maybeSingle();

        return {
            finalScore100: result.max_possible_score > 0
                ? ((result.total_score + manual.score) / result.max_possible_score) * 100 : 0,
            hasEssay: manual.pending || exam?.exam_type === 'assignment',
            ...(result.dimension_scores && Object.keys(result.dimension_scores).length > 0
                ? { dimensionScores: result.dimension_scores }
                : {}),
            examId,
        };
    }

    /**
     * Hitung ulang satu attempt terhadap keadaan bank soal SAAT INI.
     *
     * Dipanggil setelah kunci jawaban diubah. Berbeda dari
     * `gradeAttemptFromSavedAnswers`, di sini skor dimensi ikut disimpan —
     * per jawaban di `cbt_answers.metadata` dan totalnya di metadata attempt.
     *
     * Untuk kuis, penalti kecepatan TIDAK diterapkan di sini. Yang disimpan
     * hanyalah `base_score`; penaltinya dihitung sekali untuk seluruh peserta
     * lewat `applyRelativeQuizScoring`, supaya jalur submit dan jalur regrade
     * memakai model penilaian yang sama persis.
     */
    async regradeAttempt(attemptId: string): Promise<void> {
        const { data: attempt } = await this.db
            .from('cbt_exam_attempts')
            .select('id, exam_id, metadata')
            .eq('id', attemptId)
            .maybeSingle();
        if (!attempt) return;

        const row = attempt as { exam_id: string; metadata: Record<string, unknown> | null };
        if (!await hasExamQuestionSnapshots(this.db, row.exam_id)) {
            throw new BadRequestException(
                'Ujian lama ini tidak memiliki snapshot kunci. Nilai historis tidak diubah.',
            );
        }

        const [questions, { data: saved }] = await Promise.all([
            loadFrozenExamQuestions(this.db, row.exam_id),
            this.db
                .from('cbt_answers')
                .select('id, question_id, selected_option_id, essay_answer, score, is_correct')
                .eq('attempt_id', attemptId),
        ]);
        if (questions.length === 0) return;

        const answers = new Map<string, AnswerRow>(
            ((saved as AnswerRow[]) || []).map((a) => [a.question_id, a]),
        );

        // `answer_id` diisi id baris `cbt_answers` supaya hasilnya bisa ditulis
        // balik per baris; soal yang belum dijawab tetap dikirim agar ikut
        // menambah skor maksimum, tetapi tidak menghasilkan baris baru.
        const items = ((questions as any[]) || []).map((question) => {
            const answer = answers.get(question.id);
            return {
                question,
                answer_id: answer?.id ?? null,
                raw_answer: answer?.essay_answer ?? answer?.selected_option_id ?? null,
            };
        });

        const result = await this.scoring.post<GradeBatchResponse>('/grading/attempt', { items });

        const manual = manualGradeSummary(questions || [], answers);
        const finalScore = result.max_possible_score > 0
            ? ((result.total_score + manual.score) / result.max_possible_score) * 100 : 0;

        for (const item of result.items) {
            if (!item.answer_id) continue;

            const payload: Record<string, unknown> = {
                score: item.score,
                is_correct: item.is_correct,
            };
            if (item.dimension_scores && Object.keys(item.dimension_scores).length > 0) {
                payload.metadata = { dimension_scores: item.dimension_scores };
            }

            await this.db.from('cbt_answers').update(payload).eq('id', item.answer_id);
        }

        await this.db
            .from('cbt_exam_attempts')
            .update({
                total_score: finalScore,
                needs_manual_grading: manual.pending,
                metadata: {
                    ...(row.metadata || {}),
                    dimension_scores: result.dimension_scores ?? {},
                    base_score: finalScore,
                },
            })
            .eq('id', attemptId);
    }

    /**
     * Hitung ulang setiap attempt yang menjawab sebuah soal. Dipanggil setelah
     * soal atau opsinya diubah, supaya nilai yang sudah terlanjur keluar tidak
     * mengacu pada kunci jawaban lama.
     *
     * Kegagalan satu attempt tidak boleh menghentikan sisanya — soal sudah
     * terlanjur berubah, jadi berhenti di tengah justru meninggalkan sebagian
     * peserta dengan nilai lama dan sebagian dengan nilai baru.
     */
    async regradeExamAttemptsByQuestion(questionId: string): Promise<void> {
        const { data: affected, error } = await this.db
            .from('cbt_answers')
            .select('attempt_id')
            .eq('question_id', questionId);

        if (error) {
            this.logger.error(`Gagal mencari pengerjaan terdampak: ${error.message}`);
            return;
        }

        const attemptIds = [
            ...new Set(((affected as Array<{ attempt_id: string }>) || []).map((a) => a.attempt_id)),
        ];
        if (attemptIds.length === 0) return;

        this.logger.log(`Menilai ulang ${attemptIds.length} pengerjaan untuk soal ${questionId}.`);

        for (const attemptId of attemptIds) {
            try {
                await this.regradeAttempt(attemptId);
            } catch (err) {
                this.logger.error(
                    `Gagal menilai ulang pengerjaan ${attemptId}: ${(err as Error).message}`,
                );
            }
        }

        // Kuis memakai penalti kecepatan yang bersifat relatif antar peserta,
        // jadi ia harus dihitung ulang sekali untuk seluruh ujian — bukan per
        // attempt, yang hanya menyimpan `base_score`.
        const { data: attemptRows } = await this.db
            .from('cbt_exam_attempts')
            .select('exam_id')
            .in('id', attemptIds);

        const examIds = [
            ...new Set(((attemptRows as Array<{ exam_id: string }>) || []).map((r) => r.exam_id)),
        ];

        for (const examId of examIds) {
            const { data: exam } = await this.db
                .from('cbt_exams')
                .select('exam_type')
                .eq('id', examId)
                .maybeSingle();

            if ((exam as { exam_type: string | null } | null)?.exam_type === 'quiz') {
                await this.applyRelativeQuizScoring(examId);
            }
        }
    }

    /**
     * Terapkan model "peringkat kecepatan" ke SELURUH attempt terkirim sebuah
     * kuis: di antara attempt yang base score-nya sama, yang tercepat menyimpan
     * nilai penuh dan setiap attempt yang lebih lambat dikurangi 0,01 lebih
     * banyak dari sebelumnya.
     *
     * Inilah satu-satunya sumber kebenaran penilaian kuis, dipakai jalur submit
     * maupun regrade, supaya keduanya tidak pernah berbeda. Mengembalikan peta
     * attemptId → nilai akhir agar pemanggil bisa membaca nilainya sendiri.
     *
     * Perhitungannya ada di FastAPI (`/grading/relative`); yang di sini hanya
     * membaca durasi dan menulis hasilnya.
     */
    async applyRelativeQuizScoring(examId: string): Promise<Record<string, number>> {
        const { data } = await this.db
            .from('cbt_exam_attempts')
            .select('id, metadata, total_score, started_at, finished_at')
            .eq('exam_id', examId)
            .in('status', FINISHED_STATUSES);

        const rows = (data as AttemptTimingRow[]) || [];
        if (rows.length === 0) return {};

        const attempts = rows.map((a: AttemptTimingRow & { total_score?: number | null }) => {
            const start = a.started_at ? new Date(a.started_at).getTime() : 0;
            const finish = a.finished_at ? new Date(a.finished_at).getTime() : start;
            return {
                attempt_id: a.id,
                base_score: Number(a.metadata?.base_score ?? a.total_score ?? 0),
                duration_seconds: Math.max(0, Math.floor((finish - start) / 1000)),
            };
        });

        const { scores } = await this.scoring.post<{ scores: Record<string, number> }>(
            '/grading/relative',
            { attempts },
        );

        await this.db.transaction(async db => {
            for (const [attemptId, score] of Object.entries(scores)) {
                const row = rows.find((attempt) => attempt.id === attemptId) as
                    (AttemptTimingRow & { total_score?: number | null }) | undefined;
                const baseScore = Number(row?.metadata?.base_score ?? row?.total_score ?? 0);
                const { error } = await db
                    .from('cbt_exam_attempts')
                    .update({
                        total_score: score,
                        metadata: { ...(row?.metadata || {}), base_score: baseScore },
                    })
                    .eq('id', attemptId);
                if (error) throw new InternalServerErrorException('Nilai relatif gagal disimpan.');
            }
        });

        return scores;
    }

    /** Terapkan skor relatif hanya bila ujian memang bertipe kuis. */
    async applyRelativeQuizScoringIfQuiz(examId: string): Promise<Record<string, number>> {
        const { data: exam } = await this.db
            .from('cbt_exams')
            .select('exam_type')
            .eq('id', examId)
            .maybeSingle();
        return (exam as { exam_type?: string } | null)?.exam_type === 'quiz'
            ? this.applyRelativeQuizScoring(examId)
            : {};
    }

    /**
     * Database menjadi antrean durable: auto-submit dengan `total_score` null
     * berarti status penutupan sudah aman tetapi panggilan Python belum selesai.
     * Monitoring dan kunjungan ulang siswa dapat menjalankan retry ini berulang
     * kali; penilaian jawaban serta update attempt bersifat idempoten.
     */
    async retryPendingAutoSubmissions(
        examId: string,
        limit = 25,
    ): Promise<{ recovered: number; failed: number }> {
        const { data, error } = await this.db
            .from('cbt_exam_attempts')
            .select('id, metadata, status, finished_at')
            .eq('exam_id', examId)
            .in('status', ['submitted', 'auto_submitted'])
            .is('total_score', null)
            .order('finished_at', { ascending: true })
            .limit(limit);
        if (error) throw new InternalServerErrorException('Antrean penilaian belum dapat dibaca.');

        let recovered = 0;
        let failed = 0;
        for (const row of (data as Array<{ id: string; metadata: Record<string, unknown> | null; status: string; finished_at: string | null }>) || []) {
            try {
                const graded = await this.gradeAttemptFromSavedAnswers(row.id);
                if (!graded) continue;
                const metadata = {
                    ...(row.metadata || {}),
                    base_score: graded.finalScore100,
                    dimension_scores: graded.dimensionScores || {},
                    grading_retry_error: null,
                    grading_recovered_at: new Date().toISOString(),
                };
                const { data: updated, error: updateError } = await this.db
                    .from('cbt_exam_attempts')
                    .update({
                        total_score: graded.finalScore100,
                        needs_manual_grading: graded.hasEssay,
                        metadata,
                    })
                    .eq('id', row.id)
                    .eq('status', row.status)
                    .eq('finished_at', row.finished_at)
                    .is('total_score', null)
                    .select('id')
                    .maybeSingle();
                if (updateError) throw new Error(updateError.message);
                if (updated) recovered += 1;
            } catch (retryError) {
                failed += 1;
                const retryCount = Number(row.metadata?.grading_retry_count || 0) + 1;
                await this.db
                    .from('cbt_exam_attempts')
                    .update({
                        metadata: {
                            ...(row.metadata || {}),
                            grading_retry_count: retryCount,
                            grading_retry_at: new Date().toISOString(),
                            grading_retry_error: (retryError as Error).message.slice(0, 200),
                        },
                    })
                    .eq('id', row.id)
                    .eq('status', row.status)
                    .eq('finished_at', row.finished_at)
                    .is('total_score', null);
                this.logger.error(
                    `Retry penilaian auto-submit ${row.id} gagal: ${(retryError as Error).message}`,
                );
            }
        }

        if (recovered > 0) await this.applyRelativeQuizScoringIfQuiz(examId);
        return { recovered, failed };
    }

    async calculateIrt(user: AuthUser, examId: string) {
        await this.authz.assertExamStaff(user, examId);

        const { data: exam } = await this.db
            .from('cbt_exams')
            .select('scoring_type')
            .eq('id', examId)
            .maybeSingle();

        if (!exam) throw new NotFoundException('Ujian tidak ditemukan.');
        if (!await hasExamQuestionSnapshots(this.db, examId)) {
            throw new BadRequestException(
                'IRT tidak dapat dihitung ulang karena ujian lama tidak memiliki snapshot soal.',
            );
        }

        const scoringTypes = String((exam as { scoring_type: string | null }).scoring_type || 'classical')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);

        const [questions, attemptResult] = await Promise.all([
            loadFrozenExamQuestions(this.db, examId),
            this.db
                .from('cbt_exam_attempts')
                .select(
                    `id, user_id, needs_manual_grading,
                     answers:cbt_answers(
                         question_id, is_correct, score, essay_answer, selected_option_id
                     )`,
                )
                .eq('exam_id', examId)
                .in('status', FINISHED_STATUSES),
        ]);
        const { data: attempts, error } = attemptResult;

        if (error) {
            this.logger.error(`Gagal membaca pengerjaan untuk IRT: ${error.message}`);
            throw new InternalServerErrorException('Gagal membaca data pengerjaan.');
        }

        const rows = (attempts as any[]) || [];
        if (rows.length === 0) {
            throw new BadRequestException('Belum ada peserta yang menyelesaikan ujian.');
        }
        if (questions.length === 0) {
            throw new BadRequestException('Bank soal ujian tidak ditemukan.');
        }

        // IRT harus melihat matriks peserta × seluruh soal. Query relasi jawaban
        // hanya berisi soal yang sempat tersimpan; bila langsung dikirim, soal
        // yang dilewati siswa hilang dari penyebut dan nilainya menjadi terlalu
        // tinggi. Lengkapi jawaban yang hilang sebagai respons kosong/skor nol.
        const normalizedRows = rows.map((attempt) => {
            const answers = new Map<string, any>(
                ((attempt.answers as any[]) || []).map((answer) => [answer.question_id, answer]),
            );
            return {
                ...attempt,
                answers: (questions as any[]).map((question) => ({
                    question_id: question.id,
                    is_correct: null,
                    score: 0,
                    essay_answer: null,
                    selected_option_id: null,
                    ...(answers.get(question.id) || {}),
                    bank_questions: question,
                })),
            };
        });

        // FastAPI tidak punya akses database: seluruh data dikirim lewat payload,
        // dihitung di sana, lalu hasilnya ditulis kembali dari sini.
        const result = await this.scoring.post<{
            count: number;
            attempts: IrtAttemptScore[];
            items: unknown[];
            warnings: string[];
        }>('/irt/calculate', {
            exam_id: examId,
            scoring_types: scoringTypes,
            attempts: normalizedRows,
        });

        // Penulisan dilakukan per attempt karena nilainya berbeda-beda; jumlah
        // peserta per ujian masih dalam ratusan.
        for (const attempt of result.attempts) {
            await this.db
                .from('cbt_exam_attempts')
                .update({
                    detailed_scores: attempt.detailed_scores,
                    score_irt: attempt.score_irt,
                })
                .eq('id', attempt.id);
        }

        return { count: result.count, items: result.items, warnings: result.warnings || [] };
    }
}
