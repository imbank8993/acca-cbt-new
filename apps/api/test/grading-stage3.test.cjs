const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { GradingService } = require('../src/grading/grading.service.ts');

function fixture(manualScore = 8, manualCorrect = true) {
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', question_bank_id: 'bank' }],
        cbt_exam_attempts: [{ id: 'attempt', exam_id: 'exam', status: 'submitted', metadata: { retained: true } }],
        cbt_bank_questions: [{ id: 'essay', bank_id: 'bank', type: 'essay', score_default: 10 },
            { id: 'mcq', bank_id: 'bank', type: 'mcq', score_default: 10 }],
        cbt_exam_question_snapshots: [
            { exam_id: 'exam', order_number: 1, question_snapshot: { id: 'essay', type: 'essay', score_default: 10 } },
            { exam_id: 'exam', order_number: 2, question_snapshot: { id: 'mcq', type: 'mcq', score_default: 10 } },
        ],
        cbt_answers: [{ id: 'essay-answer', question_id: 'essay', attempt_id: 'attempt', score: manualScore, is_correct: manualCorrect, metadata: { feedback: 'Keep this' } },
            { id: 'mcq-answer', question_id: 'mcq', attempt_id: 'attempt', score: 0, selected_option_id: 'b' }],
    });
    const scoring = { post: async (_, { items }) => ({
        // The real batch endpoint skips essays; it does not return score-zero essay items.
        items: items.filter(i => i.question.type !== 'essay').map(i => ({ answer_id: i.answer_id, question_id: i.question.id, score: 10, is_correct: true, dimension_scores: {} })),
        total_score: 10, max_possible_score: 20, scaled_score: 50, needs_manual_grading: true, dimension_scores: {},
    }) };
    return { db, service: new GradingService(db, {}, scoring) };
}

test('BUG-15: regrade includes manual essay contribution and preserves answer/feedback', async () => {
    const { db, service } = fixture();
    const originalEssay = structuredClone(db.tables.cbt_answers[0]);
    await service.regradeAttempt('attempt');
    assert.equal(db.tables.cbt_exam_attempts[0].total_score, 90);
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.base_score, 90);
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.retained, true);
    assert.equal(db.tables.cbt_exam_attempts[0].needs_manual_grading, false);
    assert.deepEqual(db.tables.cbt_answers[0], originalEssay);
});
test('BUG-15: saved-answer grading also includes manual contribution', async () => {
    const { service } = fixture();
    assert.deepEqual(await service.gradeAttemptFromSavedAnswers('attempt'), {
        finalScore100: 90, hasEssay: false, examId: 'exam',
    });
});

test('relative quiz scoring includes auto-submit and preserves its original base score', async () => {
    const db = fixtureDb({
        cbt_exam_attempts: [
            { id: 'normal', exam_id: 'quiz', status: 'submitted', total_score: 80,
                metadata: { base_score: 80 }, started_at: '2026-01-01T00:00:00Z', finished_at: '2026-01-01T00:01:00Z' },
            { id: 'auto', exam_id: 'quiz', status: 'auto_submitted', total_score: 70,
                metadata: {}, started_at: '2026-01-01T00:00:00Z', finished_at: '2026-01-01T00:02:00Z' },
        ],
    });
    let sent;
    const scoring = { post: async (_, body) => {
        sent = body.attempts;
        return { scores: { normal: 80, auto: 69.99 } };
    } };
    const service = new GradingService(db, {}, scoring);

    await service.applyRelativeQuizScoring('quiz');

    assert.equal(sent.length, 2);
    assert.equal(sent.find(a => a.attempt_id === 'auto').base_score, 70);
    assert.equal(db.tables.cbt_exam_attempts.find(a => a.id === 'auto').total_score, 69.99);
    assert.equal(db.tables.cbt_exam_attempts.find(a => a.id === 'auto').metadata.base_score, 70);
});
test('BUG-15: zero manual score remains graded, null flag stays pending', async () => {
    const graded = fixture(0, false);
    await graded.service.regradeAttempt('attempt');
    assert.equal(graded.db.tables.cbt_exam_attempts[0].total_score, 50);
    assert.equal(graded.db.tables.cbt_exam_attempts[0].needs_manual_grading, false);
    const pending = fixture(0, null);
    await pending.service.regradeAttempt('attempt');
    assert.equal(pending.db.tables.cbt_exam_attempts[0].needs_manual_grading, true);
});

test('IRT sends every exam question and represents an unanswered question as zero', async () => {
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', question_bank_id: 'bank', scoring_type: 'irt_1pl' }],
        cbt_exam_attempts: [{
            id: 'attempt', exam_id: 'exam', status: 'submitted', needs_manual_grading: false, metadata: { retained: true },
            answers: [{ question_id: 'answered', score: 10, is_correct: true, selected_option_id: 'a' }],
        }],
        cbt_bank_questions: [
            { id: 'answered', bank_id: 'bank', type: 'mcq', score_default: 10 },
            { id: 'unanswered', bank_id: 'bank', type: 'mcq', score_default: 10 },
        ],
        cbt_exam_question_snapshots: [
            { exam_id: 'exam', order_number: 1, question_snapshot: { id: 'answered', type: 'mcq', score_default: 10 } },
            { exam_id: 'exam', order_number: 2, question_snapshot: { id: 'unanswered', type: 'mcq', score_default: 10 } },
        ],
    });
    let payload;
    const scoring = { post: async (_, body) => {
        payload = body;
        return { score_scale: 'theta', count: 1, attempts: [{ id: 'attempt', detailed_scores: { irt_1pl: 0 }, score_irt: 0 }], items: [] };
    } };
    const authz = { assertExamStaff: async () => {} };
    const service = new GradingService(db, authz, scoring);

    await service.calculateIrt({ id: 'staff' }, 'exam');

    assert.equal(payload.attempts[0].answers.length, 2);
    const unanswered = payload.attempts[0].answers.find(a => a.question_id === 'unanswered');
    assert.equal(unanswered.score, 0);
    assert.equal(unanswered.is_correct, null);
    assert.equal(unanswered.bank_questions.score_default, 10);
    assert.equal(db.tables.cbt_exam_attempts[0].score_irt, 0);
    assert.equal(db.tables.cbt_exam_attempts[0].irt_theta, 0);
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.irt_score_scale, 'theta');
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.retained, true);
});
