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
import { advisoryTransactionLock } from '../common/transaction-lock';
import { isEssayType } from '../common/answer-storage';
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
        pendingOnly = true,
    ): Promise<{ finalScore100: number; hasEssay: boolean; examId: string; dimensionScores?: Record<string, number> } | null> {
        const { data: loaded, error: attemptError } = await this.db.from('cbt_exam_attempts')
            .select('id, exam_id, status, finished_at, started_at, total_score').eq('id', attemptId).maybeSingle();
        if (attemptError) throw new InternalServerErrorException('Sesi penilaian belum dapat dibaca.');
        if (!loaded || !FINISHED_STATUSES.includes(loaded.status) || (pendingOnly && loaded.total_score != null)) return null;
        // Copy the generation before waiting for an external service.
        const attempt = { ...loaded };
        const examId = attempt.exam_id;
        const [questions, savedResult, examResult] = await Promise.all([
            loadFrozenExamQuestions(this.db, examId),
            this.db.from('cbt_answers').select('id, question_id, selected_option_id, essay_answer, score, is_correct, metadata').eq('attempt_id', attemptId),
            this.db.from('cbt_exams').select('exam_type').eq('id', examId).maybeSingle(),
        ]);
        if (savedResult.error || examResult.error || !examResult.data) {
            throw new InternalServerErrorException('Jawaban atau ujian belum dapat dibaca untuk penilaian.');
        }
        if (!questions.length) throw new BadRequestException('Soal ujian tidak tersedia untuk penilaian.');
        const answers = new Map<string, AnswerRow>((savedResult.data || []).map((a: AnswerRow) => [a.question_id, { ...a }]));
        const result = await this.scoring.post<GradeBatchResponse>('/grading/attempt', {
            items: questions.map(question => ({ question, answer_id: question.id,
                raw_answer: answers.get(question.id)?.essay_answer ?? answers.get(question.id)?.selected_option_id ?? null })),
        }, { timeoutMs: 15_000 });
        return this.db.transaction(async db => {
            await db.raw('SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE', attemptId);
            const { data: current, error } = await db.from('cbt_exam_attempts')
                .select('status, finished_at, started_at, total_score, metadata').eq('id', attemptId).maybeSingle();
            if (error) throw new InternalServerErrorException('Status penilaian belum dapat dibaca.');
            if (!current || current.status !== attempt.status || current.started_at !== attempt.started_at ||
                current.finished_at !== attempt.finished_at || (pendingOnly && current.total_score != null)) return null;
            const { data: latestRows, error: readError } = await db.from('cbt_answers')
                .select('id, question_id, selected_option_id, essay_answer, score, is_correct, metadata').eq('attempt_id', attemptId);
            if (readError) throw new InternalServerErrorException('Jawaban belum dapat diverifikasi.');
            const latest = new Map<string, any>((latestRows || []).map((a: any) => [a.question_id, a]));
            // No stale answer payload may be applied, even if a writer forgot to change the generation.
            if (questions.some(q => (latest.get(q.id)?.essay_answer ?? latest.get(q.id)?.selected_option_id ?? null) !==
                (answers.get(q.id)?.essay_answer ?? answers.get(q.id)?.selected_option_id ?? null))) return null;
            for (const question of questions.filter(q => isEssayType(q.type))) {
                if (latest.has(question.id)) continue;
                const { data: created, error: createError } = await db.from('cbt_answers').insert({
                    attempt_id: attemptId, question_id: question.id, selected_option_id: null,
                    essay_answer: null, score: 0, is_correct: null,
                }).select('id, question_id, score, is_correct').single();
                if (createError || !created) throw new InternalServerErrorException('Jawaban esai kosong belum dapat disimpan.');
                latest.set(question.id, created);
            }
            for (const item of result.items) {
                const question = questions.find(q => q.id === item.answer_id);
                if (!question || isEssayType(question.type) || !latest.has(question.id)) continue;
                const row = latest.get(question.id);
                const { error: writeError } = await db.from('cbt_answers').update({
                    score: item.score, is_correct: item.is_correct,
                    metadata: { ...(row.metadata || {}), dimension_scores: item.dimension_scores || {} },
                }).eq('attempt_id', attemptId).eq('question_id', question.id);
                if (writeError) throw new InternalServerErrorException('Nilai jawaban belum tersimpan.');
            }
            // A teacher may have graded essays while the scoring request was running.
            const manual = manualGradeSummary(questions, latest);
            const finalScore100 = result.max_possible_score > 0
                ? ((result.total_score + manual.score) / result.max_possible_score) * 100 : 0;
            const hasEssay = manual.pending || examResult.data.exam_type === 'assignment';
            const { error: totalError } = await db.from('cbt_exam_attempts').update({
                total_score: finalScore100, needs_manual_grading: hasEssay,
                metadata: { ...(current.metadata || {}), base_score: finalScore100,
                    dimension_scores: result.dimension_scores || {}, relative_scoring_pending: examResult.data.exam_type === 'quiz', grading_retry_error: null,
                    grading_retry_next_at: null, grading_recovered_at: new Date().toISOString() },
            }).eq('id', attemptId);
            if (totalError) throw new InternalServerErrorException('Total nilai belum tersimpan.');
            return { finalScore100, hasEssay, examId,
                ...(result.dimension_scores && Object.keys(result.dimension_scores).length
                    ? { dimensionScores: result.dimension_scores } : {}) };
        });
    }

    /** Regrade only finished attempts against their immutable exam snapshot. */
    async regradeAttempt(attemptId: string): Promise<void> {
        const { data: attempt, error } = await this.db.from('cbt_exam_attempts')
            .select('exam_id, status').eq('id', attemptId).maybeSingle();
        if (error) throw new InternalServerErrorException('Sesi penilaian belum dapat dibaca.');
        if (!attempt || !FINISHED_STATUSES.includes(attempt.status)) return;
        if (!await hasExamQuestionSnapshots(this.db, attempt.exam_id)) {
            throw new BadRequestException('Ujian lama ini tidak memiliki snapshot kunci. Nilai historis tidak diubah.');
        }
        await this.gradeAttemptFromSavedAnswers(attemptId, false);
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
        const { data, error } = await this.db.from('cbt_exam_attempts')
            .select('id, metadata, total_score, started_at, finished_at, status')
            .eq('exam_id', examId).in('status', FINISHED_STATUSES);
        if (error) throw new InternalServerErrorException('Nilai kuis belum dapat dibaca.');
        const rows = (data || []).filter((row: any) => row.total_score != null)
            .map((row: any) => ({ ...row, metadata: { ...(row.metadata || {}) } }));
        if (!rows.length) return {};
        const { scores } = await this.scoring.post<{ scores: Record<string, number> }>('/grading/relative', {
            attempts: rows.map((row: any) => ({ attempt_id: row.id,
                base_score: Number(row.metadata.base_score ?? row.total_score),
                duration_seconds: Math.max(0, Math.floor((Date.parse(row.metadata?.scoring_finished_at || row.finished_at) - Date.parse(row.started_at)) / 1000)) || 0,
            })),
        }, { timeoutMs: 15_000 });
        return this.db.transaction(async db => {
            await advisoryTransactionLock(db, `relative-grading:${examId}`);
            // Lock consistently, then validate the entire cohort before writing any score.
            for (const id of rows.map((r: any) => r.id).sort()) {
                await db.raw('SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE', id);
            }
            const { data: latest, error: readError } = await db.from('cbt_exam_attempts')
                .select('id, metadata, total_score, started_at, finished_at, status')
                .eq('exam_id', examId).in('status', FINISHED_STATUSES);
            if (readError) throw new InternalServerErrorException('Nilai kuis belum dapat diverifikasi.');
            const current = new Map<string, any>((latest || []).filter((r: any) => r.total_score != null).map((r: any) => [r.id, r]));
            if (current.size !== rows.length || rows.some((row: any) => {
                const now = current.get(row.id);
                return !now || now.status !== row.status || now.started_at !== row.started_at || now.finished_at !== row.finished_at ||
                    now.total_score !== row.total_score || Number(now.metadata?.base_score ?? now.total_score) !== Number(row.metadata.base_score ?? row.total_score);
            })) return {};
            for (const row of rows) {
                const score = scores[row.id];
                if (!Number.isFinite(score)) throw new InternalServerErrorException('Hasil nilai relatif tidak lengkap.');
                const now = current.get(row.id);
                const { error: writeError } = await db.from('cbt_exam_attempts').update({ total_score: score,
                    metadata: { ...(now.metadata || {}), base_score: Number(row.metadata.base_score ?? row.total_score), relative_scoring_pending: false },
                }).eq('id', row.id);
                if (writeError) throw new InternalServerErrorException('Nilai relatif gagal disimpan.');
            }
            return scores;
        });
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
        examId?: string,
        limit = 25,
    ): Promise<{ recovered: number; failed: number }> {
        const { data, error } = examId ? await this.db.from('cbt_exam_attempts')
            .select('id, metadata, status, started_at, finished_at, exam_id').eq('exam_id', examId)
            .in('status', FINISHED_STATUSES).is('total_score', null)
            .order('finished_at', { ascending: true }).limit(limit)
            : { data: await this.db.raw<any[]>(`
                SELECT id, metadata, status, started_at, finished_at, exam_id
                FROM public.cbt_exam_attempts
                WHERE status IN ('submitted', 'auto_submitted') AND total_score IS NULL
                  AND COALESCE(metadata->>'grading_retry_next_at', '') <= $1
                ORDER BY finished_at, id LIMIT $2`, new Date().toISOString(), limit), error: null };
        if (error) throw new InternalServerErrorException('Antrean penilaian belum dapat dibaca.');
        const exams = new Set<string>();
        let recovered = 0;
        let failed = 0;
        for (const loaded of data || []) {
            const row = { ...loaded, started_at: loaded.started_at instanceof Date ? loaded.started_at.toISOString() : loaded.started_at,
                finished_at: loaded.finished_at instanceof Date ? loaded.finished_at.toISOString() : loaded.finished_at };
            try {
                const nextAt = Date.parse(String(row.metadata?.grading_retry_next_at || ''));
                if (Number.isFinite(nextAt) && nextAt > Date.now()) continue;
                const graded = await this.gradeAttemptFromSavedAnswers(row.id, true);
                if (graded) { recovered += 1; exams.add(graded.examId); }
            } catch (retryError) {
                failed += 1;
                await this.db.transaction(async db => {
                    await db.raw('SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE', row.id);
                    const { data: current, error: readError } = await db.from('cbt_exam_attempts')
                        .select('status, started_at, finished_at, total_score, metadata').eq('id', row.id).maybeSingle();
                    if (readError) throw new InternalServerErrorException('Status antrean belum dapat dibaca.');
                    if (!current || current.status !== row.status || current.started_at !== row.started_at ||
                        String(current.finished_at) !== String(row.finished_at) || current.total_score != null) return;
                    const retryCount = Number(current.metadata?.grading_retry_count || 0) + 1;
                    const { error: writeError } = await db.from('cbt_exam_attempts').update({ metadata: {
                        ...(current.metadata || {}), grading_retry_count: retryCount, grading_retry_at: new Date().toISOString(),
                        grading_retry_next_at: new Date(Date.now() + Math.min(300_000, 15_000 * 2 ** Math.min(retryCount, 5))).toISOString(),
                        grading_retry_error: (retryError as Error).message.slice(0, 200),
                    } }).eq('id', row.id);
                    if (writeError) throw new InternalServerErrorException('Status retry belum tersimpan.');
                });
                this.logger.error(
                    `Retry penilaian auto-submit ${row.id} gagal: ${(retryError as Error).message}`,
                );
            }
        }

        for (const id of exams) await this.applyRelativeQuizScoringIfQuiz(id);
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
                    `id, user_id, status, started_at, finished_at, needs_manual_grading,
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

        const rows = structuredClone((attempts as any[]) || []);
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

        const fingerprint = (values: any[]) => JSON.stringify(values.map(row => ({
            id: row.id, status: row.status, started_at: row.started_at, finished_at: row.finished_at,
            needs_manual_grading: row.needs_manual_grading,
            answers: (row.answers || []).map((a: any) => ({ question_id: a.question_id,
                is_correct: a.is_correct, score: a.score, essay_answer: a.essay_answer,
                selected_option_id: a.selected_option_id })).sort((a: any, b: any) => a.question_id.localeCompare(b.question_id)),
        })).sort((a, b) => a.id.localeCompare(b.id)));
        if (result.attempts.length !== rows.length || new Set(result.attempts.map(a => a.id)).size !== rows.length ||
            result.attempts.some(a => !rows.some(row => row.id === a.id))) {
            throw new InternalServerErrorException('Hasil IRT tidak lengkap.');
        }
        await this.db.transaction(async db => {
            for (const id of rows.map(row => row.id).sort()) {
                await db.raw('SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE', id);
            }
            const current = await db.from('cbt_exam_attempts').select(
                `id, user_id, status, started_at, finished_at, needs_manual_grading,
                 answers:cbt_answers(question_id, is_correct, score, essay_answer, selected_option_id)`,
            ).eq('exam_id', examId).in('status', FINISHED_STATUSES);
            if (current.error) throw new InternalServerErrorException('Gagal memeriksa ulang pengerjaan.');
            if (fingerprint(current.data || []) !== fingerprint(rows)) {
                throw new BadRequestException('Pengerjaan berubah selama perhitungan IRT. Hitung ulang.');
            }
            for (const attempt of result.attempts) {
                const { data: saved, error: saveError } = await db
                .from('cbt_exam_attempts')
                .update({
                    detailed_scores: attempt.detailed_scores,
                    score_irt: attempt.score_irt,
                })
                .eq('id', attempt.id).select('id').maybeSingle();
                if (saveError || !saved) throw new InternalServerErrorException('Nilai IRT gagal disimpan.');
            }
        });

        return { count: result.count, items: result.items, warnings: result.warnings || [] };
    }
}
