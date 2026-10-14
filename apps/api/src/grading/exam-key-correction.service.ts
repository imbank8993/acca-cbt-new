import { BadRequestException, ConflictException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { applyExamQuestionKey, examQuestionKey, type AuthUser, type KeyQuestion } from '@acca-cbt/shared';
import { randomUUID } from 'node:crypto';
import { AuthorizationService } from '../auth/authorization.service';
import { DbService, type DbSession } from '../prisma/prisma-db-adapter';
import { readExamQuestionVersion, hasExamQuestionSnapshots } from '../common/exam-question-snapshots';
import { advisoryTransactionLock } from '../common/transaction-lock';
import { GradingService } from './grading.service';
import { ExamKeyCorrectionDto } from './exam-key-correction.dto';

@Injectable()
export class ExamKeyCorrectionService {
    constructor(private readonly db: DbService, private readonly authz: AuthorizationService, private readonly grading: GradingService) {}
    private async exam(db: DbSession, examId: string) {
        const { data, error } = await db.from('cbt_exams').select('*').eq('id', examId).maybeSingle();
        if (error || !data) throw new BadRequestException('Ujian belum dapat dibaca.');
        return data;
    }
    private async lock(db: DbSession, examId: string) {
        await advisoryTransactionLock(db, `exam-key-correction:${examId}`);
        await db.raw('SELECT id FROM public.cbt_exams WHERE id = $1::uuid FOR UPDATE', examId);
    }
    private async write(db: DbSession, examId: string, values: Record<string, unknown>) {
        const { error } = await db.from('cbt_exams').update(values).eq('id', examId);
        if (error) throw new InternalServerErrorException('Perubahan kunci belum tersimpan.');
    }
    private async assertCorrectionAccess(user: AuthUser, examId: string) {
        await this.authz.assertExamStaff(user, examId);
        const questions = await readExamQuestionVersion(this.db, examId);
        for (const bankId of new Set(questions.map(question => question.bank_id))) {
            if (typeof bankId !== 'string') throw new BadRequestException('Pemilik bank soal historis belum dapat diverifikasi.');
            await this.authz.assertBankAccess(user, bankId);
        }
    }
    async get(user: AuthUser, examId: string) {
        await this.assertCorrectionAccess(user, examId);
        if (!await hasExamQuestionSnapshots(this.db, examId)) throw new BadRequestException('Ujian ini tidak memiliki salinan soal historis. Koreksi kunci tidak tersedia.');
        const exam = await this.exam(this.db, examId);
        return { questions: await readExamQuestionVersion(this.db, examId),
            revision: exam.metadata?.key_correction?.revision || 0,
            correction: exam.metadata?.key_correction || null,
            history: exam.metadata?.key_correction_history || [] };
    }
    async save(user: AuthUser, examId: string, dto: ExamKeyCorrectionDto) {
        await this.assertCorrectionAccess(user, examId);
        if (!dto.reason.trim()) throw new BadRequestException('Tuliskan alasan koreksi kunci.');
        return this.db.transaction(async db => {
            await this.lock(db, examId);
            const exam = await this.exam(db, examId);
            if ((exam.metadata?.key_correction?.revision || 0) !== dto.revision) throw new ConflictException('Kunci berubah. Muat ulang sebelum menyimpan.');
            if (exam.metadata?.key_correction && exam.metadata.key_correction.state !== 'ready') throw new ConflictException('Selesaikan penilaian ulang koreksi sebelumnya terlebih dahulu.');
            const [clock] = await db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
            if (!exam.end_time || Date.parse(exam.end_time) > new Date(clock.now).getTime() || !Number.isFinite(Date.parse(exam.end_time))) throw new BadRequestException('Koreksi tersedia setelah jadwal ujian berakhir.');
            const { data: attempts, error } = await db.from('cbt_exam_attempts').select('id, status').eq('exam_id', examId);
            if (error) throw new InternalServerErrorException('Peserta ujian belum dapat diperiksa.');
            if ((attempts || []).some((a: any) => a.status === 'in_progress')) throw new BadRequestException('Masih ada peserta yang mengerjakan ujian.');
            if (!await hasExamQuestionSnapshots(db, examId)) throw new BadRequestException('Salinan soal historis tidak tersedia.');
            const questions = await readExamQuestionVersion(db, examId);
            const changes: Array<{ questionId: string; before: string; after: string }> = [];
            const overrides = { ...(exam.metadata?.answer_key_overrides || {}) };
            if (new Set(dto.changes.map(change => change.questionId)).size !== dto.changes.length) throw new BadRequestException('Soal koreksi tidak boleh duplikat.');
            for (const change of dto.changes) {
                const question = questions.find(q => q.id === change.questionId) as KeyQuestion | undefined;
                if (!question) throw new BadRequestException('Soal bukan bagian ujian ini.');
                let revised: KeyQuestion;
                try { revised = applyExamQuestionKey(question, change.key); } catch (error) { throw new BadRequestException((error as Error).message); }
                const before = examQuestionKey(question), after = examQuestionKey(revised);
                if (before === after) continue;
                changes.push({ questionId: change.questionId, before, after });
                overrides[change.questionId] = after;
            }
            if (!changes.length) throw new BadRequestException('Tidak ada perubahan kunci.');
            const history = exam.metadata?.key_correction_history || [];
            if (history.length >= 100) throw new BadRequestException('Batas riwayat koreksi ujian tercapai.');
            const revision = dto.revision + 1;
            const attemptIds = (attempts || []).filter((a: any) => ['submitted', 'auto_submitted'].includes(a.status)).map((a: any) => a.id).sort();
            await this.write(db, examId, { show_results: false, metadata: { ...exam.metadata,
                answer_key_overrides: overrides,
                key_correction_history: [...history, { revision, actorId: user.id, at: new Date(clock.now).toISOString(), reason: dto.reason.trim(), changes }],
                key_correction: { revision, state: 'pending', attemptIds, completed: 0, total: attemptIds.length },
            } });
            const cleared = await db.from('cbt_exam_attempts').update({ total_score: null, score_irt: null, irt_theta: null, detailed_scores: null })
                .eq('exam_id', examId).in('status', ['submitted', 'auto_submitted']);
            if (cleared.error) throw new InternalServerErrorException('Nilai lama belum dapat dibatalkan.');
            return { revision, total: attemptIds.length };
        });
    }
    /** One attempt per request keeps recovery resumable and bounds HTTP request time. */
    async recalculate(user: AuthUser, examId: string) {
        await this.assertCorrectionAccess(user, examId);
        const token = randomUUID();
        const work = await this.db.transaction(async db => {
            await this.lock(db, examId);
            const exam = await this.exam(db, examId);
            const correction = exam.metadata?.key_correction;
            if (!correction) throw new BadRequestException('Belum ada koreksi kunci.');
            if (correction.state === 'ready') return { done: true, correction, exam };
            const [clock] = await db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
            if (correction.leaseUntil && Date.parse(correction.leaseUntil) > new Date(clock.now).getTime()) throw new ConflictException('Penilaian ulang sedang diproses. Coba lagi sebentar.');
            await this.write(db, examId, { metadata: { ...exam.metadata, key_correction: { ...correction,
                token, leaseUntil: new Date(new Date(clock.now).getTime() + 180000).toISOString() } } });
            return { done: false, correction, exam };
        });
        if (work.done) return { done: true, completed: work.correction.completed, total: work.correction.total };
        const attemptId = work.correction.attemptIds[work.correction.completed];
        try {
            if (attemptId) {
                const result = await this.grading.gradeAttemptFromSavedAnswers(attemptId, false);
                if (!result) throw new ConflictException('Pengerjaan berubah. Periksa peserta sebelum melanjutkan.');
            } else if (work.correction.total) {
                const cohort = await this.db.from('cbt_exam_attempts').select('id, status, total_score, needs_manual_grading')
                    .eq('exam_id', examId);
                const finished = (cohort.data || []).filter((a: any) => ['submitted', 'auto_submitted'].includes(a.status));
                if (cohort.error || (cohort.data || []).some((a: any) => a.status === 'in_progress') ||
                    JSON.stringify(finished.map((a: any) => a.id).sort()) !== JSON.stringify(work.correction.attemptIds) ||
                    finished.some((a: any) => a.total_score == null)) {
                    throw new ConflictException('Data peserta berubah atau masih ada nilai tertunda. Periksa peserta sebelum melanjutkan.');
                }
                if (String(work.exam.scoring_type).includes('irt_') && finished.some((a: any) => a.needs_manual_grading)) {
                    throw new BadRequestException('Selesaikan koreksi esai seluruh peserta sebelum menghitung ulang IRT.');
                }
                await this.grading.applyRelativeQuizScoringIfQuiz(examId);
                if (String(work.exam.scoring_type).includes('irt_')) await this.grading.calculateIrt(user, examId);
            }
            return await this.db.transaction(async db => {
                await this.lock(db, examId);
                const exam = await this.exam(db, examId), correction = exam.metadata?.key_correction;
                if (correction?.token !== token) throw new ConflictException('Proses penilaian berubah. Muat ulang.');
                const completed = correction.completed + (attemptId ? 1 : 0), done = !attemptId;
                await this.write(db, examId, { metadata: { ...exam.metadata, key_correction: { ...correction,
                    completed, state: done ? 'ready' : 'pending', token: null, leaseUntil: null, error: null } } });
                return { done, completed, total: correction.total };
            });
        } catch (error) {
            await this.db.transaction(async db => {
                await this.lock(db, examId);
                const exam = await this.exam(db, examId), correction = exam.metadata?.key_correction;
                if (correction?.token === token) await this.write(db, examId, { metadata: { ...exam.metadata,
                    key_correction: { ...correction, token: null, leaseUntil: null, error: (error as Error).message } } });
            });
            throw error;
        }
    }
}
