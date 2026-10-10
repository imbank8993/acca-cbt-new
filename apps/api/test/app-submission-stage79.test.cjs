const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { createExamSubmissionWorker } = require('../../web/lib/exam-submission-worker.ts');
const { withExamSubmissionLock } = require('../../web/lib/exam-submission-lock.ts');
const storage = require('../../web/lib/exam-durable-storage.ts');
const { fixtureDb } = require('./fixture-db.cjs');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const context = { startedAt: '2026-09-20T00:00:00Z', personalEndTime: '2026-09-20T01:00:00Z' };
const entry = { attemptId: 'attempt', examId: 'exam', userId: 'student', deviceId: 'device-id', deadlineAt: 1000, assignment: false, ...context };
function harness(overrides = {}) {
    const state = { online: true, now: 2000, active: null, user: { id: 'student' }, device: 'device-id', entries: [entry],
        snapshot: { answers: { q: 'last offline answer' }, revisions: { q: 3 }, doubtfulAnswers: [] },
        status: { success: true, examId: 'exam', status: 'in_progress', remainingSeconds: 0, canRecover: true, ...context },
        result: { success: true, savedAnswersOnly: false, submissionVerified: true }, calls: [], notifications: [] };
    const worker = createExamSubmissionWorker({
        online: () => state.online, now: () => state.now, activeExamId: () => state.active,
        list: async () => state.entries, currentUser: async () => state.user, currentDevice: async () => state.device,
        read: async () => structuredClone(state.snapshot), status: async () => { state.calls.push('status'); return state.status; },
        assignment: () => ({ textSubmission: 'attachment note' }),
        freeze: async (_, snapshot) => { state.calls.push('freeze'); state.snapshot = structuredClone(snapshot); return structuredClone(snapshot); },
        send: async (_, snapshot) => { state.calls.push({ send: structuredClone(snapshot) }); return state.result; },
        confirm: async () => { state.calls.push('confirm'); state.entries = []; },
        notify: (_, result) => state.notifications.push(result), ...overrides,
    });
    return { worker, state };
}
const sends = state => state.calls.filter(call => typeof call === 'object');

test('Dashboard delivers an expired draft after reconnection without mounting ExamPage', async () => {
    const { worker, state } = harness();
    state.online = false;
    await worker.run();
    assert.deepEqual(state.calls, []);
    state.online = true;
    await worker.run();
    assert.equal(sends(state).length, 1);
    assert.deepEqual(sends(state)[0].send.frozenSubmission, context);
    assert.equal(sends(state)[0].send.answers.q, 'last offline answer');
    assert.equal(state.calls.at(-1), 'confirm');
    await worker.run();
    assert.equal(sends(state).length, 1);
});

test('leaving the exam route allows the root worker to take over; staying there avoids racing it', async () => {
    const { worker, state } = harness();
    state.active = 'exam';
    await worker.run();
    assert.equal(state.calls.length, 0);
    state.active = null;
    await worker.run();
    assert.equal(sends(state).length, 1);
});

test('an advanced device clock never submits an exam that still has server time remaining', async () => {
    const { worker, state } = harness();
    state.now = 999999999;
    state.status.remainingSeconds = 60;
    await worker.run();
    assert.deepEqual(state.calls, ['status']);
    assert.equal(state.snapshot.frozenSubmission, undefined);
});

test('a manually frozen snapshot can be delivered before the deadline', async () => {
    const { worker, state } = harness();
    state.now = 500;
    state.status.remainingSeconds = 60;
    state.snapshot.frozenSubmission = context;
    await worker.run();
    assert.equal(sends(state).length, 1);
});

test('other accounts, missing login and other devices never send or delete queued answers', async () => {
    for (const patch of [{ user: { id: 'other' } }, { user: null }, { device: 'other-device' }]) {
        const { worker, state } = harness();
        Object.assign(state, patch);
        await worker.run();
        assert.deepEqual(state.calls, []);
        assert.equal(state.entries.length, 1);
    }
});

test('switching accounts during preflight does not transmit the answer body', async () => {
    let calls = 0;
    const { worker, state } = harness({ currentUser: async () => ({ id: ++calls === 1 ? 'student' : 'other' }) });
    await worker.run();
    assert.equal(sends(state).length, 0);
    assert.equal(state.entries.length, 1);
});

test('lost responses retain a frozen payload and retry it with backoff until confirmed', async () => {
    const { worker, state } = harness();
    state.result = { success: false, retryable: true };
    await worker.run();
    const first = sends(state)[0].send;
    assert.equal(state.entries.length, 1);
    await worker.run();
    assert.equal(sends(state).length, 1);
    state.now += 15000;
    state.result = { success: true, submissionVerified: true };
    await worker.run();
    assert.deepEqual(sends(state)[1].send, first);
    assert.equal(state.entries.length, 0);
});

test('partial acceptance and revoked or replaced attempts preserve local answers', async () => {
    for (const scenario of ['saved-only', 'replaced', 'terminated']) {
        const { worker, state } = harness();
        if (scenario === 'saved-only') state.result = { success: true, savedAnswersOnly: true };
        if (scenario === 'replaced') state.status.startedAt = '2026-09-21T00:00:00Z';
        if (scenario === 'terminated') state.status.canRecover = false;
        await worker.run();
        assert.equal(state.entries.length, 1);
        assert.equal(state.calls.includes('confirm'), false);
        assert.equal(state.notifications.length, 1);
    }
});

test('overlapping worker triggers share one running pass', async () => {
    let release, count = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const { worker } = harness({ send: async () => { count++; await gate; return { success: true }; } });
    const first = worker.run();
    const second = worker.run();
    assert.equal(first, second);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(count, 1);
    release();
    await Promise.all([first, second]);
});

test('foreground and background API submissions share a request and release after failure', async () => {
    let release, count = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const send = async () => { count++; await gate; return { success: false }; };
    const first = withExamSubmissionLock('shared-attempt', send);
    const second = withExamSubmissionLock('shared-attempt', send);
    assert.equal(first, second);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(count, 1);
    release();
    await Promise.all([first, second]);
    await withExamSubmissionLock('shared-attempt', async () => { count++; return { success: true }; });
    assert.equal(count, 2);
});

test('queue ownership index survives unavailable IndexedDB and cleanup preserves a later attempt generation', async () => {
    const previous = global.localStorage;
    const values = new Map();
    global.localStorage = { get length() { return values.size; }, key: index => [...values.keys()][index],
        getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    const session = { ...entry, attempt: { id: 'attempt', started_at: context.startedAt, personal_end_time: context.personalEndTime },
        exam: { id: 'exam' }, user: { id: 'student' }, questions: [], cachedAt: context.startedAt, lastQuestionIndex: 0 };
    try {
        await storage.registerExamSubmission(session);
        let queue = await storage.listExamSubmissionRegistrations();
        assert.equal(queue.length, 1);
        assert.equal(queue[0].userId, 'student');
        const later = '2026-09-21T00:00:00Z';
        await storage.registerExamSubmission({ ...session, attempt: { ...session.attempt, started_at: later } });
        await storage.removeExamSubmissionRegistration('attempt', context.startedAt, context.personalEndTime);
        queue = await storage.listExamSubmissionRegistrations();
        assert.equal(queue[0].startedAt, later);
        await storage.removeExamSubmissionRegistration('attempt', later, context.personalEndTime);
        assert.deepEqual(await storage.listExamSubmissionRegistrations(), []);
    } finally { if (previous === undefined) delete global.localStorage; else global.localStorage = previous; }
});

test('delivery status uses server time, checks ownership and device, and does not create or change attempts', async () => {
    const db = fixtureDb({ cbt_exams: [{ id: 'exam', end_time: context.personalEndTime, duration_minutes: 60 }],
        cbt_exam_attempts: [{ id: 'attempt', exam_id: 'exam', user_id: 'student', device_fingerprint: 'device-id',
            status: 'in_progress', started_at: context.startedAt, personal_end_time: context.personalEndTime, metadata: {} }] },
        [], { now: '2026-09-20T00:59:00Z' });
    const service = new ExamAttemptsService(db, {}, {});
    const status = await service.submissionStatus({ id: 'student' }, 'attempt', 'device-id');
    assert.equal(status.remainingSeconds, 60);
    assert.equal(status.canRecover, true);
    await assert.rejects(service.submissionStatus({ id: 'other' }, 'attempt', 'device-id'));
    await assert.rejects(service.submissionStatus({ id: 'student' }, 'attempt', 'other-device'));
    assert.equal(db.writes.length, 0);
});

test('a slow device clock does not postpone delivery after the server deadline', async () => {
    const { worker, state } = harness();
    state.now = 0;
    await worker.run();
    assert.equal(sends(state).length, 1);
});

test('stopping the root worker during preflight prevents a later background submission', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { worker, state } = harness({ status: async () => { await gate; return state.status; } });
    const running = worker.run();
    await new Promise(resolve => setImmediate(resolve));
    worker.stop();
    release();
    await running;
    assert.equal(sends(state).length, 0);
    assert.equal(state.entries.length, 1);
});

test('a previously submitted session with an unfrozen draft is retained for review', async () => {
    const { worker, state } = harness();
    state.status.status = 'submitted';
    await worker.run();
    assert.equal(sends(state).length, 0);
    assert.equal(state.entries.length, 1);
    assert.equal(state.notifications.length, 1);
});


test('unverified success cannot remove the background queue or emit a success notification', async () => {
    for (const submissionVerified of [undefined, false]) {
        const { worker, state } = harness();
        state.result = { success: true, submissionVerified };
        await worker.run();
        assert.equal(state.entries.length, 1);
        assert.equal(state.calls.includes('confirm'), false);
        assert.equal(state.notifications[0].success, false);
        assert.match(state.notifications[0].error, /belum terverifikasi lengkap/);
    }
});

test('different payloads for the same attempt cannot borrow one successful response', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const first = withExamSubmissionLock('payload-test', async () => { await gate; return 'first verified'; }, 'first-payload');
    const second = withExamSubmissionLock('payload-test', async () => 'second rejected', 'second-payload');
    assert.notEqual(first, second);
    release();
    assert.equal(await first, 'first verified');
    assert.equal(await second, 'second rejected');
});


test('background snapshot conflict preserves the queue and never sends or confirms', async () => {
    const { worker, state } = harness({ freeze: async () => { throw new storage.ExamSnapshotConflictError(); } });
    await worker.run();
    assert.equal(state.entries.length, 1);
    assert.equal(sends(state).length, 0);
    assert.equal(state.calls.includes('confirm'), false);
    assert.equal(state.notifications[0].retryable, false);
});
