const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ExamReviewService } = require('../src/analytics/exam-review.service.ts');
const { ExamMonitoringService } = require('../src/proctor/exam-monitoring.service.ts');
const { TeachersService } = require('../src/teachers/teachers.service.ts');

test('manual grading uses frozen essay weight and rejects positive credit for a zero-weight essay', async () => {
    const db = fixtureDb({
        cbt_exam_attempts: [{ id: 'a', exam_id: 'e', status: 'submitted' }],
        cbt_exams: [{ id: 'e', question_bank_id: 'b' }],
        cbt_bank_questions: [{ id: 'q', bank_id: 'b', type: 'essay', score_default: 10 }],
        cbt_exam_question_snapshots: [{ exam_id: 'e', question_snapshot: { id: 'q', type: 'essay', score_default: 0 } }],
        cbt_answers: [{ id: 'answer', attempt_id: 'a', question_id: 'q', score: 0, is_correct: null }],
    });
    const service = Object.create(TeachersService.prototype);
    Object.assign(service, { db, authz: { assertExamStaff: async () => {} } });
    await assert.rejects(service.submitEssayGrades({ id: 'teacher' }, 'a', { answer: 1 }), error => error.getStatus?.() === 400);
    assert.equal(db.writes.length, 0);
});

test('review includes ordering and essay aliases, preserves partial scores and excludes personality weights', async () => {
    const kinds = ['ordering', 'mcq_complex', 'true_false', 'short_answer', 'matching', 'categorization', 'esay', 'uraian'];
    const questions = kinds.map((type, i) => ({ id: `q${i}`, type, score_default: 10 }));
    questions.push({ id: 'psy', type: 'sjt', score_default: 100 }, { id: 'zero', type: 'mcq', score_default: 0 });
    const answers = questions.map(q => ({ id: q.id, question_id: q.id, attempt_id: 'a', score: q.id === 'psy' || q.id === 'zero' ? 0 : 8, is_correct: false }));
    const db = fixtureDb({
        cbt_exam_attempts: [{ id: 'a', user_id: 'student', exam_id: 'e', status: 'submitted', exams: { show_results: true } }],
        cbt_exam_question_snapshots: questions.map((q, i) => ({ exam_id: 'e', order_number: i, question_snapshot: q })),
        cbt_answers: answers,
    });
    const result = await new ExamReviewService(db, { assertExamStaff: async () => {} }).getReview({ id: 'teacher' }, 'a');
    assert.equal(result.summary.totalScore, 64);
    assert.equal(result.summary.maxScore, 80);
    assert.equal(result.summary.percentage, 80);
    assert.equal(result.summary.partialCount, 8);
});

test('live grading sends unanswered frozen questions and uses the batch academic total', async () => {
    const questions = ['answered', 'skipped', 'personality'].map(id => ({ id, type: id === 'personality' ? 'likert' : 'mcq', score_default: 10 }));
    const db = fixtureDb({ cbt_exam_question_snapshots: questions.map(question_snapshot => ({ exam_id: 'e', question_snapshot })) });
    const service = Object.create(ExamMonitoringService.prototype);
    Object.assign(service, { db, logger: { error: error => { throw Error(error); } }, scoring: { post: async (_, body) => {
        assert.equal(body.items.length, 3);
        assert.equal(body.items.find(item => item.question.id === 'skipped').raw_answer, null);
        return { items: [{ answer_id: 'a', score: 10, is_correct: true }], scaled_score: 50 };
    } } });
    const attempt = { exam_id: 'e' };
    const answers = [{ id: 'a', question_id: 'answered', selected_option_id: 'yes', is_correct: null }];
    await service.applyLiveScores(attempt, answers);
    assert.equal(attempt.total_score, 50);
    assert.equal(answers[0].score, 10);
    assert.equal(db.writes.length, 0);
});
