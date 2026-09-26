// Run from repository root: node --test apps/api/test/exam-integrity-stage4.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');
const { PerKeyQueue } = require('../../web/lib/per-key-queue.ts');

const user = { id: 'student', isPlatformAdmin: false };
const future = '2026-09-20T01:00:00Z';
const past = '2026-09-19T23:00:00Z';

function baseTables(status = 'in_progress') {
    return {
        cbt_exams: [{
            id: 'exam', organization_id: 'school', question_bank_id: 'bank',
            exam_type: 'daily', start_time: past, end_time: future,
            duration_minutes: 60, is_published: true,
        }],
        cbt_exam_attempts: [{
            id: 'attempt', user_id: user.id, exam_id: 'exam', status,
            started_at: '2026-09-19T23:30:00Z', personal_end_time: future,
            device_fingerprint: 'device-123', metadata: {}, total_score: null,
        }],
        cbt_answers: [],
        cbt_exam_question_sources: [],
        cbt_bank_questions: [{
            id: 'q1', bank_id: 'bank', type: 'mcq', score_default: 10,
            created_at: '2026-01-01T00:00:00Z',
            bank_question_options: [{ id: 'a', is_correct: true, weight: 1 }, { id: 'b', is_correct: false, weight: 0 }],
        }],
    };
}

function service(db, overrides = {}) {
    const scoring = overrides.scoring || { post: async () => ({
        items: [], scaled_score: 0, needs_manual_grading: false, dimension_scores: {},
    }) };
    const grading = overrides.grading || { gradeAttemptFromSavedAnswers: async () => null };
    return new ExamAttemptsService(db, scoring, grading);
}

test('SEC-03: answer writes require the bound device and an active deadline', async () => {
    const db = fixtureDb(baseTables());
    const attempts = service(db);

    await assert.rejects(
        attempts.saveAnswer(user, 'attempt', { questionId: 'q1', selected_option_id: 'a' }),
        error => error.getStatus?.() === 400,
    );
    await assert.rejects(
        attempts.saveAnswer(user, 'attempt', { questionId: 'q1', selected_option_id: 'a' }, 'device-999'),
        error => error.getStatus?.() === 403,
    );
    assert.equal(db.tables.cbt_answers.length, 0);

    await attempts.saveAnswer(
        user, 'attempt', { questionId: 'q1', selected_option_id: 'a' }, 'device-123',
    );
    assert.equal(db.tables.cbt_answers[0].selected_option_id, 'a');

    db.tables.cbt_exam_attempts[0].personal_end_time = past;
    await assert.rejects(
        attempts.saveAnswer(user, 'attempt', { questionId: 'q1', selected_option_id: 'b' }, 'device-123'),
        error => error.getStatus?.() === 403,
    );
    assert.equal(db.tables.cbt_answers[0].selected_option_id, 'a');
});

test('SEC-10/SEC-14: closed attempts reject automatic late answer changes', async () => {
    const db = fixtureDb(baseTables('auto_submitted'));
    await assert.rejects(
        service(db).syncLateAnswers(
            user, 'attempt', [{ questionId: 'q1', selected_option_id: 'b' }], 'device-123',
        ),
        error => error.getStatus?.() === 403 && /reset dari proktor/i.test(String(error.message)),
    );
    assert.equal(db.tables.cbt_answers.length, 0);
});

test('BUG-10: a proctor recovery window can resume after the global end time', async () => {
    const tables = baseTables();
    tables.cbt_exams[0].end_time = '2026-09-19T23:59:00Z';
    tables.cbt_exams[0].metadata = { is_public: true };
    tables.cbt_exam_attempts[0].personal_end_time = '2026-09-20T00:10:00Z';
    tables.cbt_exam_attempts[0].metadata = {
        proctor_recovery_until: '2026-09-20T00:10:00Z',
    };
    tables.cbt_organization_members = [
        { user_id: user.id, organization_id: 'school', is_active: true },
    ];
    tables.cbt_class_members = [];
    tables.cbt_additional_class_members = [];
    tables.cbt_exam_participants = [];
    tables.cbt_exam_targets = [];

    const db = fixtureDb(tables);
    const resumed = await service(db).start(user, 'exam', 'device-123');
    assert.equal(resumed.started, true);
    assert.equal(resumed.attempt.id, 'attempt');
    assert.equal(resumed.remainingSeconds, 600);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
});

test('SEC-10: repeated force termination does not regrade or rewrite a closed attempt', async () => {
    const tables = baseTables('submitted');
    tables.cbt_exam_attempts[0].finished_at = '2026-09-19T23:55:00Z';
    let graded = 0;
    const db = fixtureDb(tables);
    const proctoring = new ProctoringService(db, {}, {
        gradeAttemptFromSavedAnswers: async () => { graded += 1; return null; },
    });

    await proctoring.forceTerminate(user, 'attempt', 'duplicate request');
    assert.equal(graded, 0);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
    assert.equal(db.tables.cbt_exam_attempts[0].finished_at, '2026-09-19T23:55:00Z');
    assert.equal((db.tables.cbt_attempt_security_logs || []).length, 0);
});

test('SEC-10: automatic expiry is compare-and-set and grades only once', async () => {
    let graded = 0;
    const db = fixtureDb(baseTables());
    const attempts = service(db, { grading: {
        gradeAttemptFromSavedAnswers: async () => {
            graded += 1;
            return { finalScore100: 75, hasEssay: false };
        },
    } });

    await attempts.autoFinish('attempt', new Date('2026-09-20T00:00:00Z'));
    await attempts.autoFinish('attempt', new Date('2026-09-20T00:00:05Z'));
    assert.equal(graded, 1);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'auto_submitted');
    assert.equal(db.tables.cbt_exam_attempts[0].total_score, 75);
});

test('BUG-03: failed answer persistence rolls back submission status', async () => {
    const tables = baseTables();
    tables.cbt_bank_questions[0] = {
        id: 'q1', bank_id: 'bank', type: 'mcq', score_default: 10,
        created_at: '2026-01-01T00:00:00Z',
        bank_question_options: [{ id: 'a', is_correct: true, weight: 1 }],
    };
    const db = fixtureDb(tables, ['cbt_answers']);
    const attempts = service(db, { scoring: { post: async () => ({
        items: [{ answer_id: 'q1', score: 10, is_correct: true, dimension_scores: {} }],
        scaled_score: 100, needs_manual_grading: false, dimension_scores: {},
    }) } });

    await assert.rejects(
        attempts.submit(user, 'exam', { q1: 'a' }, undefined, 'attempt', 'device-123'),
        error => error.getStatus?.() === 400,
    );
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
    assert.equal(db.tables.cbt_exam_attempts[0].finished_at, undefined);
});

test('BUG-08: per-question queue preserves rapid autosave order', async () => {
    const queue = new PerKeyQueue();
    const events = [];
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });

    const first = queue.enqueue('q1', async () => {
        events.push('first:start');
        await firstGate;
        events.push('first:end');
    });
    const second = queue.enqueue('q1', async () => { events.push('second'); });
    const other = queue.enqueue('q2', async () => { events.push('other'); });

    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, ['first:start', 'other']);
    assert.equal(queue.has('q1'), true);
    releaseFirst();
    await Promise.all([first, second, other]);
    assert.deepEqual(events, ['first:start', 'other', 'first:end', 'second']);
    assert.equal(queue.has('q1'), false);
});
