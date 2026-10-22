const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ExamKeyCorrectionService } = require('../src/grading/exam-key-correction.service.ts');
const { GradingService } = require('../src/grading/grading.service.ts');
const { readExamQuestionVersion } = require('../src/common/exam-question-snapshots.ts');
const { isScoreExcluded } = require('../src/common/score-exclusion.ts');
const { ExamReviewService } = require('../src/analytics/exam-review.service.ts');

const user = { id: 'staff' };
const mcq = id => ({ id, bank_id: 'bank', type: 'mcq', score_default: 1, question_text: id,
    bank_question_options: [{ id: `${id}-a`, is_correct: true }, { id: `${id}-b`, is_correct: false }] });
function fixture() {
    const questions = [mcq('q1'), mcq('q2'), { id: 'e1', bank_id: 'bank', type: 'essay', score_default: 5, question_text: 'esai' },
        { id: 'p1', bank_id: 'bank', type: 'likert', score_default: 1, question_text: 'likert' }];
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', show_results: true, end_time: '2026-09-19T00:00:00Z', scoring_type: 'classical', metadata: {} }],
        cbt_exam_question_snapshots: questions.map((question_snapshot, order_number) => ({ exam_id: 'exam', order_number, question_snapshot })),
        cbt_exam_attempts: [{ id: 'one', exam_id: 'exam', status: 'submitted', total_score: 50 }],
        cbt_answers: [],
    });
    const auth = { assertBankAccess: async () => undefined, assertExamStaff: async () => undefined };
    return { db, service: new ExamKeyCorrectionService(db, auth, {}) };
}

test('voiding a question records it, closes results, invalidates scores and marks the frozen copy', async () => {
    const { db, service } = fixture();
    const result = await service.save(user, 'exam', { revision: 0, reason: 'Soal 2 cacat: dua opsi benar', changes: [],
        voids: [{ questionId: 'q2', excluded: true }] });
    assert.equal(result.revision, 1);
    const exam = db.tables.cbt_exams[0];
    assert.equal(exam.show_results, false);
    assert.equal(exam.metadata.voided_questions.q2.reason, 'Soal 2 cacat: dua opsi benar');
    assert.deepEqual(exam.metadata.key_correction_history[0].voids, [{ questionId: 'q2', excluded: true }]);
    assert.equal(db.tables.cbt_exam_attempts[0].total_score, null);
    const frozen = await readExamQuestionVersion(db, 'exam');
    assert.equal(isScoreExcluded(frozen.find(q => q.id === 'q2')), true);
    assert.equal(isScoreExcluded(frozen.find(q => q.id === 'q1')), false);
    // The stored snapshot itself is never rewritten.
    assert.equal(db.tables.cbt_exam_question_snapshots[1].question_snapshot.metadata, undefined);
    assert.equal((await service.get(user, 'exam')).voided.q2.reason, 'Soal 2 cacat: dua opsi benar');
});

test('a voided question can be restored in a later revision', async () => {
    const { db, service } = fixture();
    await service.save(user, 'exam', { revision: 0, reason: 'cacat', changes: [], voids: [{ questionId: 'q2', excluded: true }] });
    db.tables.cbt_exams[0].metadata.key_correction.state = 'ready';
    await service.save(user, 'exam', { revision: 1, reason: 'ternyata benar', changes: [], voids: [{ questionId: 'q2', excluded: false }] });
    assert.deepEqual(db.tables.cbt_exams[0].metadata.voided_questions, {});
    assert.equal(isScoreExcluded((await readExamQuestionVersion(db, 'exam')).find(q => q.id === 'q2')), false);
});

test('essays can be voided; personality items, unknown questions, no-ops and voiding everything are refused', async () => {
    const { db, service } = fixture();
    const save = voids => service.save(user, 'exam', { revision: 0, reason: 'x', changes: [], voids });
    await assert.rejects(save([{ questionId: 'p1', excluded: true }]), /kepribadian/);
    await assert.rejects(save([{ questionId: 'nope', excluded: true }]), /bukan bagian/);
    await assert.rejects(save([{ questionId: 'q1', excluded: false }]), /Tidak ada perubahan/);
    await assert.rejects(save(['q1', 'q2', 'e1'].map(questionId => ({ questionId, excluded: true }))), /minimal satu soal/);
    await save([{ questionId: 'e1', excluded: true }]);
    assert.ok(db.tables.cbt_exams[0].metadata.voided_questions.e1);
});

test('regrading from saved answers ignores a voided essay that was never graded', async () => {
    const { db, service } = fixture();
    await service.save(user, 'exam', { revision: 0, reason: 'esai cacat', changes: [], voids: [{ questionId: 'e1', excluded: true }] });
    db.tables.cbt_answers = [{ id: 'a1', attempt_id: 'one', question_id: 'q1', selected_option_id: 'q1-a', essay_answer: null, score: null, is_correct: null }];
    let sentQuestions;
    const scoring = { post: async (_path, body) => {
        sentQuestions = body.items.map(item => item.question);
        return { items: [{ answer_id: 'q1', question_id: 'q1', score: 1, is_correct: true, dimension_scores: {} }],
            total_score: 1, max_possible_score: 2, scaled_score: 50, needs_manual_grading: false, dimension_scores: {} };
    } };
    const grading = new GradingService(db, {}, scoring);
    const result = await grading.gradeAttemptFromSavedAnswers('one', false);
    assert.equal(sentQuestions.find(q => q.id === 'e1').metadata.score_excluded, true);
    assert.equal(result.hasEssay, false, 'voided essay must not keep the attempt waiting for manual grading');
    assert.equal(db.tables.cbt_exam_attempts[0].needs_manual_grading, false);
});
