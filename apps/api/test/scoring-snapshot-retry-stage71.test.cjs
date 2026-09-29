const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { loadFrozenExamQuestions } = require('../src/common/exam-question-snapshots.ts');
const { GradingService } = require('../src/grading/grading.service.ts');

test('exam question snapshot keeps the original key after bank edits', async () => {
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', question_bank_id: 'bank' }],
        cbt_exam_question_sources: [],
        cbt_bank_questions: [{
            id: 'question', bank_id: 'bank', type: 'mcq', score_default: 10,
            bank_question_options: [{ id: 'a', is_correct: true }, { id: 'b', is_correct: false }],
        }],
        cbt_exam_question_snapshots: [],
    });

    const first = await loadFrozenExamQuestions(db, 'exam');
    db.tables.cbt_bank_questions[0].bank_question_options[0].is_correct = false;
    db.tables.cbt_bank_questions[0].bank_question_options[1].is_correct = true;
    const second = await loadFrozenExamQuestions(db, 'exam');

    assert.equal(first[0].bank_question_options[0].is_correct, true);
    assert.equal(second[0].bank_question_options[0].is_correct, true);
    assert.equal(db.tables.cbt_exam_question_snapshots.length, 1);
});

test('legacy exam remains readable but current key is not mislabeled as a historical snapshot', async () => {
    const db = fixtureDb({
        cbt_exams: [{ id: 'legacy', question_bank_id: 'bank' }],
        cbt_exam_attempts: [{ id: 'old', exam_id: 'legacy', status: 'submitted' }],
        cbt_exam_question_sources: [],
        cbt_bank_questions: [{ id: 'question', bank_id: 'bank', type: 'mcq', score_default: 1 }],
        cbt_exam_question_snapshots: [],
    });
    const questions = await loadFrozenExamQuestions(db, 'legacy');
    assert.equal(questions.length, 1);
    assert.equal(db.tables.cbt_exam_question_snapshots.length, 0);
});

test('regrade refuses a legacy attempt without an authentic key snapshot', async () => {
    const db = fixtureDb({
        cbt_exam_attempts: [{ id: 'old', exam_id: 'legacy', status: 'submitted' }],
        cbt_exam_question_snapshots: [],
    });
    const service = new GradingService(db, {}, {});
    await assert.rejects(service.regradeAttempt('old'), /tidak memiliki snapshot kunci/);
});

test('pending auto-submit is recovered and becomes part of relative quiz scoring', async () => {
    const db = fixtureDb({
        cbt_exam_attempts: [{
            id: 'attempt', exam_id: 'quiz', status: 'auto_submitted', total_score: null,
            finished_at: '2026-01-01T00:01:00Z', metadata: { retained: true },
        }],
    });
    const service = new GradingService(db, {}, {});
    service.gradeAttemptFromSavedAnswers = async () => ({ finalScore100: 75, hasEssay: false, examId: 'quiz' });
    let relativeExam = null;
    service.applyRelativeQuizScoringIfQuiz = async examId => { relativeExam = examId; return {}; };

    assert.deepEqual(await service.retryPendingAutoSubmissions('quiz'), { recovered: 1, failed: 0 });
    const attempt = db.tables.cbt_exam_attempts[0];
    assert.equal(attempt.total_score, 75);
    assert.equal(attempt.metadata.base_score, 75);
    assert.equal(attempt.metadata.retained, true);
    assert.equal(relativeExam, 'quiz');
});

test('failed retry remains queued and records retry diagnostics', async () => {
    const db = fixtureDb({
        cbt_exam_attempts: [{
            id: 'attempt', exam_id: 'exam', status: 'auto_submitted', total_score: null,
            finished_at: '2026-01-01T00:01:00Z', metadata: {},
        }],
    });
    const service = new GradingService(db, {}, {});
    service.gradeAttemptFromSavedAnswers = async () => { throw new Error('python offline'); };

    assert.deepEqual(await service.retryPendingAutoSubmissions('exam'), { recovered: 0, failed: 1 });
    const attempt = db.tables.cbt_exam_attempts[0];
    assert.equal(attempt.total_score, null);
    assert.equal(attempt.metadata.grading_retry_count, 1);
    assert.match(attempt.metadata.grading_retry_error, /python offline/);
});

test('snapshot and pending-grading indexes are present in the migration', () => {
    const sql = fs.readFileSync(path.resolve(__dirname,
        '../../../database/migrations/20260929_01_exam_question_snapshots_and_grading_queue.sql'), 'utf8');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.cbt_exam_question_snapshots/i);
    assert.match(sql, /UNIQUE \(exam_id, question_id\)/i);
    assert.match(sql, /status = 'auto_submitted' AND total_score IS NULL/i);
});
