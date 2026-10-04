const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');
const { ExamMonitoringService } = require('../src/proctor/exam-monitoring.service.ts');
const { writeExamSnapshot, freezeExamSnapshot, readExamSnapshot, removeExamSnapshot, validateExamRecoverySession } = require('../../web/lib/exam-durable-storage.ts');
const user = { id: 'student' }, device = 'original-device';
const context = { startedAt: '2026-09-20T00:00:00Z', personalEndTime: '2026-09-20T01:00:00Z' };
const grading = { gradeAttemptFromSavedAnswers: async () => null, applyRelativeQuizScoringIfQuiz: async () => {}, retryPendingAutoSubmissions: async () => ({ recovered: 0, failed: 0 }) };
function fixture(status = 'in_progress') {
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', question_bank_id: 'bank', duration_minutes: 60, end_time: context.personalEndTime }],
        cbt_exam_attempts: [{ id: 'attempt', exam_id: 'exam', user_id: user.id, status,
            started_at: context.startedAt, personal_end_time: context.personalEndTime,
            device_fingerprint: device, metadata: status === 'auto_submitted' ? { closed_by_expiry: true } : {} }],
        cbt_exam_question_snapshots: [{ exam_id: 'exam', question_snapshot: { id: 'q', type: 'essay', bank_question_options: [] } }],
        cbt_answers: [], cbt_attempt_security_logs: [],
    }, [], { now: '2026-09-20T02:00:00Z' });
    const service = new ExamAttemptsService(db, { post: async () => { throw new Error('scoring offline'); } }, grading);
    return { db, service };
}
const submit = (service, answers = { q: 'written offline' }, ctx = context, student = user, fromDevice = device) =>
    service.submit(student, 'exam', answers, undefined, 'attempt', fromDevice, { q: 1 }, ctx);

test('offline answers submit after expiry without a proctor, whether still open or auto-closed', async () => {
    for (const status of ['in_progress', 'auto_submitted']) {
        const { db, service } = fixture(status);
        const result = await submit(service);
        assert.equal(result.savedAnswersOnly, false);
        assert.equal(result.gradingPending, true);
        assert.equal(db.tables.cbt_answers[0].essay_answer, 'written offline');
        assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
        assert.ok(db.tables.cbt_exam_attempts[0].metadata.frozen_submission_received_at);
        const retry = await submit(service, { q: 'must never replace' });
        assert.equal(retry.alreadySubmitted, true);
        assert.equal(db.tables.cbt_answers[0].essay_answer, 'written offline');
    }
});

test('wrong user, device, attempt generation and deadline cannot restore a snapshot', async () => {
    for (const [ctx, student, fromDevice] of [
        [context, { id: 'other' }, device], [context, user, 'other-device'],
        [{ ...context, startedAt: '2026-09-19T00:00:00Z' }, user, device],
        [{ ...context, personalEndTime: '2026-09-20T03:00:00Z' }, user, device],
    ]) {
        const { db, service } = fixture();
        await assert.rejects(submit(service, { q: 'forged' }, ctx, student, fromDevice));
        assert.equal(db.tables.cbt_answers.length, 0);
        assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
    }
});

test('disciplinary or staff termination is never reopened by automatic submission', async () => {
    const { db, service } = fixture('auto_submitted');
    db.tables.cbt_exam_attempts[0].metadata = {};
    await assert.rejects(submit(service), error => error.getStatus() === 403);
    assert.equal(db.tables.cbt_answers.length, 0);
});

test('proctor recovery permits only a frozen submission and keeps the original device binding', async () => {
    const { db, service } = fixture('auto_submitted');
    const proctor = new ProctoringService(db, { assertExamStaff: async () => {} }, grading);
    await proctor.resetAttempt({ id: 'proctor' }, 'attempt', 'Gangguan jaringan terverifikasi', 15);
    const attempt = db.tables.cbt_exam_attempts[0];
    assert.equal(attempt.metadata.recovery_submit_only, true);
    assert.equal(attempt.device_fingerprint, device);
    await assert.rejects(service.saveAnswer(user, 'attempt', { questionId: 'q', essay_answer: 'new', revision: 1 }, device));
    await assert.rejects(service.syncAnswers(user, 'attempt', [{ questionId: 'q', essay_answer: 'new', revision: 1 }], device));
    await assert.rejects(service.submit(user, 'exam', { q: 'new' }, undefined, 'attempt', device, { q: 1 }));
    await service.beginSubmit(user, 'attempt', device);
    assert.equal((await submit(service)).savedAnswersOnly, false);
    assert.equal(db.tables.cbt_answers[0].essay_answer, 'written offline');
});

test('monitoring expiry preserves eligibility for exactly one offline submission', async () => {
    const { db, service } = fixture();
    const monitor = new ExamMonitoringService(db, {}, {}, grading, {});
    await monitor.finalizeExpired('exam');
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.closed_by_expiry, true);
    await submit(service);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
});

test('frozen snapshot survives reload and refuses later local edits or changed retry payloads', async () => {
    const previous = global.localStorage;
    const values = new Map();
    global.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    try {
        const draft = { answers: { q: 'last keystroke' }, revisions: { q: 4 }, doubtfulAnswers: [] };
        await writeExamSnapshot('frozen-test', draft);
        await freezeExamSnapshot('frozen-test', { ...draft, frozenSubmission: context, assignmentData: { textSubmission: 'note' } });
        await writeExamSnapshot('frozen-test', { ...draft, answers: { q: 'late change' } });
        const restored = await readExamSnapshot('frozen-test');
        assert.equal(restored.answers.q, 'last keystroke');
        assert.deepEqual(restored.frozenSubmission, context);
        assert.equal(restored.assignmentData.textSubmission, 'note');
        const retry = await freezeExamSnapshot('frozen-test', { ...draft, answers: { q: 'different retry' }, frozenSubmission: context });
        assert.equal(retry.answers.q, 'last keystroke');
        await removeExamSnapshot('frozen-test');
        assert.equal(await readExamSnapshot('frozen-test'), null);
    } finally { if (previous === undefined) delete global.localStorage; else global.localStorage = previous; }
});

test('expired offline session can reload only through the explicit submit-only option', () => {
    const session = { examId: 'exam', attemptId: 'attempt', userId: user.id, deviceId: device,
        user, exam: { id: 'exam' }, attempt: { id: 'attempt' }, questions: [], deadlineAt: 1000, lastQuestionIndex: 0 };
    const expected = { examId: 'exam', userId: user.id, deviceId: device, now: 2000 };
    assert.equal(validateExamRecoverySession(session, expected).valid, false);
    assert.equal(validateExamRecoverySession(session, { ...expected, allowExpiredForSubmission: true }).valid, true);
    assert.equal(validateExamRecoverySession(session, { ...expected, deviceId: 'other', allowExpiredForSubmission: true }).valid, false);
});

test('browser sends the frozen context and retries after a lost response without proctor recovery', async () => {
    const { submitExamAction } = require('../../web/lib/api/students.ts');
    const { db, service } = fixture('auto_submitted');
    const original = { fetch: global.fetch, window: global.window, localStorage: global.localStorage };
    global.window = {};
    global.localStorage = { getItem: () => device, setItem: () => {} };
    let loseResponse = true;
    global.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        const isIntent = url.endsWith('/submit-intent');
        const result = isIntent ? await service.beginSubmit(user, 'attempt', body.deviceId)
            : await service.submit(user, 'exam', body.answers, body.assignmentData, body.attemptId, body.deviceId, body.answerRevisions, body.frozenSubmission);
        if (!isIntent && loseResponse) { loseResponse = false; throw new Error('response lost'); }
        return new Response(JSON.stringify({ success: true, ...result }));
    };
    try {
        const send = () => submitExamAction('exam', { q: 'offline final' }, undefined, 'attempt', { q: 1 }, context);
        assert.equal((await send()).success, false);
        assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
        assert.equal(db.tables.cbt_answers[0].essay_answer, 'offline final');
        const retry = await send();
        assert.equal(retry.success, true);
        assert.equal(retry.savedAnswersOnly, false);
        assert.equal(retry.alreadySubmitted, true);
    } finally {
        global.fetch = original.fetch;
        if (original.window === undefined) delete global.window; else global.window = original.window;
        if (original.localStorage === undefined) delete global.localStorage; else global.localStorage = original.localStorage;
    }
});

test('invalid frozen answers roll back without closing or partially writing the attempt', async () => {
    const { db, service } = fixture();
    await assert.rejects(submit(service, { q: 'valid', 'other-question': 'invalid' }));
    assert.equal(db.tables.cbt_answers.length, 0);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
});
