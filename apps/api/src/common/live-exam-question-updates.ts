import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DbSession } from '../prisma/prisma-db-adapter';
import { EXAM_QUESTION_SNAPSHOT_SELECT } from './exam-question-snapshots';
import { advisoryTransactionLock } from './transaction-lock';

type Question = Record<string, any>;

function canonical(value: any): string {
    const normalize = (item: any): any => Array.isArray(item) ? item.map(normalize)
        : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key])])) : item;
    return JSON.stringify(normalize(value));
}

/** Presentation edits do not invalidate a grade; keys, weights and scoring metadata do. */
export function questionScoringFingerprint(question: Question): string {
    const { image_url, instructions, order_index, group_key, pembahasan, kisi_kisi, ...metadata } = question.metadata || {};
    return canonical({ type: question.type, score: question.score_default, dimension: question.dimension_id || null,
        metadata, options: (question.bank_question_options || []).map((option: Question) => {
            const { image_url: image, ...optionMetadata } = option.metadata || {};
            return { id: option.id, correct: option.is_correct, weight: option.weight,
                order: ['ordering', 'ranking'].includes(question.type) ? option.order : undefined, metadata: optionMetadata };
        }).sort((a: Question, b: Question) => a.id.localeCompare(b.id)) });
}

/** Called inside the bank save transaction, while the question row is locked. */
export async function syncLiveExamQuestion(
    db: DbSession, questionId: string, organizationId: string, actorId: string,
): Promise<number> {
    const snapshots = await db.from('cbt_exam_question_snapshots')
        .select('exam_id, question_snapshot').eq('question_id', questionId);
    if (snapshots.error) throw new BadRequestException('Versi soal ujian belum dapat diperiksa.');
    if (!snapshots.data?.length) return 0;

    const current = await db.from('cbt_bank_questions').select(EXAM_QUESTION_SNAPSHOT_SELECT).eq('id', questionId).single();
    if (current.error || !current.data) throw new BadRequestException('Revisi soal belum dapat dibaca.');
    const question = current.data as Question;
    let updated = 0;
    for (const snapshot of [...snapshots.data].sort((a, b) => a.exam_id.localeCompare(b.exam_id))) {
        const examId = snapshot.exam_id;
        // Same lock as grading and manual corrections: an old scoring response cannot overwrite the new key.
        await advisoryTransactionLock(db, `exam-key-correction:${examId}`);
        await db.raw('SELECT id FROM public.cbt_exams WHERE id = $1::uuid FOR UPDATE', examId);
        const result = await db.from('cbt_exams').select('id, organization_id, status, end_time, metadata')
            .eq('id', examId).maybeSingle();
        if (result.error) throw new BadRequestException('Status ujian belum dapat dibaca.');
        const exam = result.data;
        const [clock] = await db.raw<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
        if (!exam || exam.organization_id !== organizationId || !['draft', 'scheduled', 'active'].includes(exam.status) ||
            (exam.end_time && !(Date.parse(exam.end_time) > new Date(clock.now).getTime()))) continue;
        const metadata = { ...(exam.metadata || {}) };
        if (metadata.key_correction && metadata.key_correction.state !== 'ready') {
            throw new ConflictException('Selesaikan koreksi kunci ujian terlebih dahulu sebelum mengedit bank soal.');
        }
        const previous = snapshot.question_snapshot as Question;
        const oldOptions: Question[] = previous.bank_question_options || [];
        const options: Question[] = question.bank_question_options || [];
        if (previous.type !== question.type || oldOptions.length !== options.length ||
            oldOptions.some(old => !options.some(option => option.id === old.id)) ||
            (previous.stimulus?.id || null) !== (question.stimulus?.id || null)) {
            throw new ConflictException('Soal dipakai pada ujian yang belum selesai. Pertahankan tipe soal, jumlah dan ID opsi, serta stimulusnya. Teks dan kunci tetap dapat diperbaiki.');
        }
        // Keep question grouping and option presentation stable, including after a reload.
        const next: Question = { ...question, metadata: { ...(question.metadata || {}),
            order_index: previous.metadata?.order_index, group_key: previous.metadata?.group_key },
            bank_question_options: oldOptions.map(old => {
                const option = options.find(option => option.id === old.id)!;
                return { ...option, order: ['ordering', 'ranking'].includes(question.type) ? option.order : old.order };
            }) };
        const scoringChanged = questionScoringFingerprint(previous) !== questionScoringFingerprint(next) ||
            typeof metadata.answer_key_overrides?.[questionId] === 'string';
        const at = new Date(clock.now).toISOString();
        metadata.live_question_revision = Number(metadata.live_question_revision || 0) + 1;
        metadata.live_question_update_history = [...(metadata.live_question_update_history || []), {
            questionId, actorId, at, revision: next.revision, scoringChanged, previous,
            previousKeyOverride: metadata.answer_key_overrides?.[questionId] || null,
        }];
        if (metadata.answer_key_overrides?.[questionId]) {
            metadata.answer_key_overrides = { ...metadata.answer_key_overrides };
            delete metadata.answer_key_overrides[questionId];
        }
        const saved = await db.from('cbt_exam_question_snapshots').update({ question_snapshot: next })
            .eq('exam_id', examId).eq('question_id', questionId);
        if (saved.error) throw new BadRequestException('Revisi soal ujian belum tersimpan.');
        if (scoringChanged) {
            // Invalidate every finished attempt, including participants who skipped this question.
            const attempts = await db.from('cbt_exam_attempts').select('id, metadata')
                .eq('exam_id', examId).in('status', ['submitted', 'auto_submitted']);
            if (attempts.error) throw new BadRequestException('Peserta untuk penilaian ulang belum dapat dibaca.');
            for (const attempt of [...(attempts.data || [])].sort((a, b) => a.id.localeCompare(b.id))) {
                await db.raw('SELECT id FROM public.cbt_exam_attempts WHERE id = $1::uuid FOR UPDATE', attempt.id);
                const latest = await db.from('cbt_exam_attempts').select('metadata, status').eq('id', attempt.id).maybeSingle();
                if (latest.error) throw new BadRequestException('Status peserta belum dapat diperiksa.');
                if (!latest.data || !['submitted', 'auto_submitted'].includes(latest.data.status)) continue;
                const cleared = await db.from('cbt_exam_attempts').update({ total_score: null,
                    score_irt: null, irt_theta: null, detailed_scores: null,
                    metadata: { ...(latest.data.metadata || {}), grading_retry_next_at: null,
                        grading_retry_error: null, live_question_revision: metadata.live_question_revision } }).eq('id', attempt.id);
                if (cleared.error) throw new BadRequestException('Antrean penilaian ulang belum tersimpan.');
            }
            metadata.live_question_regrade_pending = true;
        }
        const savedExam = await db.from('cbt_exams').update({ metadata }).eq('id', examId);
        if (savedExam.error) throw new BadRequestException('Riwayat revisi soal belum tersimpan.');
        updated++;
    }
    return updated;
}
