const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { GradingService } = require('../src/grading/grading.service.ts');

function fixture(manualScore = 8, manualCorrect = true) {
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', question_bank_id: 'bank' }],
        cbt_exam_attempts: [{ id: 'attempt', exam_id: 'exam', metadata: { retained: true } }],
        cbt_bank_questions: [{ id: 'essay', bank_id: 'bank', type: 'essay', score_default: 10 },
            { id: 'mcq', bank_id: 'bank', type: 'mcq', score_default: 10 }],
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
    assert.deepEqual(await service.gradeAttemptFromSavedAnswers('attempt'), { finalScore100: 90, hasEssay: false });
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
