const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');
const { ExamScreenshotsService } = require('../src/proctoring/exam-screenshots.service.ts');
const { submissionDigest } = require('../src/common/submission-commitment.ts');
const { validateSubmissionSecurityEvents } = require('../src/common/student-security-events.ts');
const user = { id: 'student' }, device = 'bound-device';
const start = '2026-09-20T00:00:00.000Z', end = '2026-09-20T01:00:00.000Z';
const now = '2026-09-20T00:30:00.000Z';
const id = '0a78af61-cd0c-44d9-bbec-e169e1b4ac83';
const id2 = '55b83e30-3b53-4ce6-a996-daaef920b930';
const descriptor = (patch = {}) => ({ id, eventType: 'tab_switch', metadata: { timestamp: now }, createdAt: now, ...patch });
const payload = (events = [descriptor()]) => ({ answers: { q: 'final answer' }, answerRevisions: { q: 1 },
    frozenSubmission: { startedAt: start, personalEndTime: end }, securityEvents: events });
function fixture(options = {}, config = {}) {
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', question_bank_id: 'bank', duration_minutes: 60, end_time: end,
            metadata: { screenshot_enabled: true, max_violations: 3 } }],
        cbt_exam_attempts: [{ id: 'attempt', exam_id: 'exam', user_id: user.id, status: 'in_progress',
            started_at: start, personal_end_time: end, device_fingerprint: device, metadata: {},
            warning_count: 0, tab_switch_count: 0 }],
        cbt_exam_question_snapshots: [{ exam_id: 'exam', question_snapshot: { id: 'q', type: 'essay', bank_question_options: [] } }],
        cbt_answers: [], cbt_attempt_security_logs: [], cbt_exam_screenshots: [],
    }, [], { now, ...options });
    const grading = { gradeAttemptFromSavedAnswers: async () => null, applyRelativeQuizScoringIfQuiz: async () => {} };
    const service = new ExamAttemptsService(db, { post: config.score || (async () => { throw new Error('scoring offline'); }) }, grading);
    const proctor = new ProctoringService(db, {}, grading);
    return { db, service, proctor };
}
const submit = (service, value = payload(), actor = user, fromDevice = device) => service.submit(actor, 'exam', value.answers,
    value.assignmentData, 'attempt', fromDevice, value.answerRevisions, value.frozenSubmission, value.securityEvents);

test('intent registers the last event before capture/upload; after submit its duplicate and image are still accepted', async () => {
    const { db, service, proctor } = fixture();
    const intent = await service.beginSubmit(user, 'attempt', device, payload());
    assert.deepEqual(intent.acceptedSecurityEventIds, [id]);
    assert.equal(db.tables.cbt_attempt_security_logs[0].metadata.client_event_id, id);
    assert.equal((await submit(service)).submissionVerified, true);
    const before = structuredClone(db.tables.cbt_exam_attempts[0]);
    const duplicate = await proctor.logViolation(user, 'attempt', 'tab_switch', {}, id);
    assert.equal(duplicate.duplicate, true);
    assert.equal(db.tables.cbt_attempt_security_logs.length, 1);
    assert.deepEqual(db.tables.cbt_exam_attempts[0], before);
    const screenshot = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3, 0xff, 0xd9]).toString('base64');
    let uploads = 0;
    const images = new ExamScreenshotsService(db, {}, { putObject: async () => { uploads++; return { success: true }; } },
        { get: () => 'fixture-secret-key-at-least-16' });
    assert.equal((await images.upload(user, 'attempt', id, device, screenshot)).saved, true);
    assert.equal(uploads, 1);
    assert.equal(db.tables.cbt_exam_screenshots.length, 1);
});

test('direct submit atomically closes answers and event manifest before external scoring returns', async () => {
    let release, started;
    const scoringStarted = new Promise(resolve => { started = resolve; });
    const { db, service } = fixture({}, { score: async () => { started(); return new Promise((_, reject) => { release = () => reject(new Error('offline')); }); } });
    const pending = submit(service);
    await scoringStarted;
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
    assert.equal(db.tables.cbt_answers[0].essay_answer, 'final answer');
    assert.equal(db.tables.cbt_attempt_security_logs[0].metadata.client_event_id, id);
    release();
    assert.equal((await pending).submissionVerified, true);
});

test('manifest or intent write failure rolls back both evidence and state', async () => {
    for (const failure of [
        { table: 'cbt_attempt_security_logs', mutation: 'insert' },
        { table: 'cbt_exam_attempts', mutation: 'update' },
    ]) {
        const { db, service } = fixture({ failMutation: failure });
        await assert.rejects(service.beginSubmit(user, 'attempt', device, payload()));
        assert.equal(db.tables.cbt_attempt_security_logs.length, 0);
        assert.deepEqual(db.tables.cbt_exam_attempts[0].metadata, {});
        await assert.rejects(submit(service));
        assert.equal(db.tables.cbt_attempt_security_logs.length, 0);
        assert.equal(db.tables.cbt_answers.length, 0);
        assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
    }
});

test('intent replay and conventional event retry count each client ID once without changing the answer commitment', async () => {
    const { db, service, proctor } = fixture();
    const original = payload();
    const extended = payload([descriptor(), descriptor({ id: id2, eventType: 'exit_fullscreen' })]);
    assert.equal(submissionDigest(original), submissionDigest(extended));
    await service.beginSubmit(user, 'attempt', device, original);
    await service.beginSubmit(user, 'attempt', device, extended);
    await proctor.logViolation(user, 'attempt', 'exit_fullscreen', {}, id2);
    assert.equal(db.tables.cbt_attempt_security_logs.length, 2);
    assert.equal(db.tables.cbt_exam_attempts[0].warning_count, 2);
    assert.equal(db.tables.cbt_exam_attempts[0].tab_switch_count, 1);
    await assert.rejects(service.beginSubmit(user, 'attempt', device, { ...extended, answers: { q: 'changed' } }), e => e.getStatus() === 409);
    assert.equal((await submit(service, extended)).submissionVerified, true);
    assert.equal(db.tables.cbt_answers[0].essay_answer, 'final answer');
});

test('threshold replay while a timely submit intent is active cannot terminate before final answers are committed', async () => {
    const { db, service, proctor } = fixture();
    const events = [descriptor(), descriptor({ id: id2, eventType: 'exit_fullscreen' }),
        descriptor({ id: '2440ecc9-ad62-4e71-808c-596eb28ca8dc', eventType: 'restricted_shortcut' })];
    await service.beginSubmit(user, 'attempt', device, payload(events));
    const result = await proctor.logViolation(user, 'attempt', events[2].eventType, {}, events[2].id);
    assert.equal(result.warningCount, 3);
    assert.equal(result.terminated, false);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
    await assert.rejects(service.saveAnswer(user, 'attempt', { questionId: 'q', essay_answer: 'new edit', revision: 2 }, device),
        error => error.getStatus() === 409);
    await assert.rejects(service.syncAnswers(user, 'attempt', [{ questionId: 'q', essay_answer: 'new edit', revision: 2 }], device),
        error => error.getStatus() === 409);
    await assert.rejects(submit(service, { ...payload(events), answers: { q: 'altered direct submit' } }),
        error => error.getStatus() === 409);
    assert.equal(db.tables.cbt_answers.length, 0);
    assert.equal((await submit(service, payload(events))).submissionVerified, true);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
    assert.equal(db.tables.cbt_answers[0].essay_answer, 'final answer');
});

test('legacy unbound intent cannot defer the server violation threshold', async () => {
    const { db, service, proctor } = fixture();
    await service.beginSubmit(user, 'attempt', device);
    for (const eventId of [id, id2, '2440ecc9-ad62-4e71-808c-596eb28ca8dc']) {
        await proctor.logViolation(user, 'attempt', 'tab_switch', {}, eventId);
    }
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'auto_submitted');
    assert.equal(db.tables.cbt_exam_attempts[0].warning_count, 3);
});

test('intent winning between violation count and termination lock preserves the committed final submission', async () => {
    const { db, service, proctor } = fixture();
    await proctor.logViolation(user, 'attempt', 'tab_switch', {}, id);
    await proctor.logViolation(user, 'attempt', 'tab_switch', {}, id2);
    const force = proctor.forceTerminate.bind(proctor);
    proctor.forceTerminate = async (...args) => {
        await service.beginSubmit(user, 'attempt', device, payload());
        return force(...args);
    };
    const result = await proctor.logViolation(user, 'attempt', 'tab_switch', {}, '2440ecc9-ad62-4e71-808c-596eb28ca8dc');
    assert.equal(result.terminated, false);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
    assert.equal((await submit(service)).submissionVerified, true);
    assert.equal(db.tables.cbt_answers[0].essay_answer, 'final answer');
});

test('closed attempts accept existing IDs only and never alter counters, grades or results', async () => {
    const { db, service, proctor } = fixture();
    await submit(service);
    db.tables.cbt_exam_attempts[0].total_score = 91;
    const before = structuredClone(db.tables.cbt_exam_attempts[0]);
    const retry = await service.beginSubmit(user, 'attempt', device,
        payload([descriptor(), descriptor({ id: id2 })]));
    assert.deepEqual(retry.acceptedSecurityEventIds, [id]);
    assert.equal((await submit(service, payload([descriptor({ id: id2 })]))).submissionVerified, true);
    assert.deepEqual(db.tables.cbt_exam_attempts[0], before);
    assert.equal(db.tables.cbt_attempt_security_logs.length, 1);
    await assert.rejects(proctor.logViolation(user, 'attempt', 'tab_switch', {}, id2), e => e.getStatus() === 400);
});

test('expiry atomically saves eligible event metadata while retaining the original saved-answer-only policy', async () => {
    const { db, service } = fixture({ now: '2026-09-20T01:00:01.000Z' });
    const value = payload();
    value.frozenSubmission = undefined;
    const result = await submit(service, value);
    assert.equal(result.savedAnswersOnly, true);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'auto_submitted');
    assert.equal(db.tables.cbt_answers.length, 0);
    assert.equal(db.tables.cbt_attempt_security_logs.length, 1);
});

test('wrong actor, wrong device and a stale frozen attempt cannot write manifest evidence', async () => {
    for (const [actor, fromDevice, value] of [
        [{ id: 'other' }, device, payload()], [user, 'wrong-device', payload()],
        [user, device, { ...payload(), frozenSubmission: { startedAt: '2026-09-19T00:00:00.000Z', personalEndTime: end } }],
    ]) {
        const { db, service } = fixture();
        await assert.rejects(submit(service, value, actor, fromDevice));
        assert.equal(db.tables.cbt_attempt_security_logs.length, 0);
        assert.equal(db.tables.cbt_answers.length, 0);
    }
    for (const [actor, fromDevice] of [[{ id: 'other' }, device], [user, 'wrong-device']]) {
        const { db, service } = fixture();
        await assert.rejects(service.beginSubmit(actor, 'attempt', fromDevice, payload()));
        assert.equal(db.tables.cbt_attempt_security_logs.length, 0);
    }
});

test('stale, post-deadline or skewed client timestamps cannot block valid answers or attach to a new generation', async () => {
    const { db, service } = fixture();
    for (const createdAt of ['2026-09-19T23:59:59.000Z', '2026-09-20T02:00:00.000Z']) {
        const intent = await service.beginSubmit(user, 'attempt', device, payload([descriptor({ createdAt })]));
        assert.deepEqual(intent.acceptedSecurityEventIds, []);
    }
    assert.equal((await submit(service, payload([descriptor({ createdAt: '2026-09-19T23:59:59.000Z' })]))).submissionVerified, true);
    assert.equal(db.tables.cbt_attempt_security_logs.length, 0);
});

for (const resetType of ['RESET_BY_PROCTOR', 'MAKEUP_EXAM_STARTED']) {
    test(`${resetType} rejects new manifest IDs at or before the latest reset without recounting acknowledged history`, async () => {
        const { db, service } = fixture();
        const resetAt = '2026-09-20T00:20:00.000Z';
        const original = { id: 'original-log', attempt_id: 'attempt', event_type: 'tab_switch',
            created_at: '2026-09-20T00:10:00.000Z', metadata: {
                client_event_id: id, source: 'student', actor_id: user.id,
            } };
        db.tables.cbt_attempt_security_logs.push(
            { id: 'earlier-reset', attempt_id: 'attempt', event_type: resetType,
                created_at: '2026-09-20T00:15:00.000Z', metadata: {} },
            { id: 'latest-reset', attempt_id: 'attempt', event_type: resetType, created_at: resetAt, metadata: {} },
            structuredClone(original),
        );
        db.tables.cbt_exam_attempts[0].metadata.recovery_submit_only = true;
        const equalId = '2440ecc9-ad62-4e71-808c-596eb28ca8dc';
        const freshId = 'fc82e016-9543-41bb-bdc6-664488a53f30';
        const existing = descriptor({ createdAt: original.created_at });
        const stale = descriptor({ id: id2, createdAt: '2026-09-20T00:17:00.000Z' });
        const equal = descriptor({ id: equalId, createdAt: resetAt });
        const before = structuredClone(db.tables.cbt_attempt_security_logs);

        const replay = await service.beginSubmit(user, 'attempt', device, payload([existing, stale, equal]));
        assert.deepEqual(replay.acceptedSecurityEventIds, [id]);
        assert.deepEqual(db.tables.cbt_attempt_security_logs, before);
        assert.equal(db.tables.cbt_exam_attempts[0].warning_count, 0);
        assert.equal(db.tables.cbt_exam_attempts[0].tab_switch_count, 0);

        const fresh = descriptor({ id: freshId, createdAt: '2026-09-20T00:20:00.001Z' });
        const next = await service.beginSubmit(user, 'attempt', device, payload([existing, stale, equal, fresh]));
        assert.deepEqual(next.acceptedSecurityEventIds, [id, freshId]);
        assert.deepEqual(db.tables.cbt_attempt_security_logs.slice(0, before.length), before);
        assert.equal(db.tables.cbt_attempt_security_logs.length, before.length + 1);
        assert.equal(db.tables.cbt_exam_attempts[0].warning_count, 1);
        assert.equal(db.tables.cbt_exam_attempts[0].tab_switch_count, 1);
    });
}

test('student manifest rejects staff types, invalid IDs, oversized batches/metadata and image payloads', () => {
    for (const value of [
        [descriptor({ eventType: 'RESET_BY_PROCTOR' })], [descriptor({ eventType: 'FORCE_TERMINATED' })],
        [descriptor({ id: 'not-a-uuid' })], [descriptor({ createdAt: 'invalid' })],
        Array(101).fill(descriptor()), [descriptor({ metadata: { screenshotBase64: 'xxxx' } })],
        [descriptor({ metadata: { reason: 'x'.repeat(4097) } })], [descriptor(), descriptor()],
    ]) assert.throws(() => validateSubmissionSecurityEvents(value), e => e.getStatus() === 400);
});

test('student metadata cannot impersonate staff or another actor, and reused IDs cannot replace event types', async () => {
    const { db, service, proctor } = fixture();
    await service.beginSubmit(user, 'attempt', device, payload([descriptor({ metadata: {
        source: 'staff', actor_id: 'proctor', client_event_id: id2, timestamp: start,
    } })]));
    const metadata = db.tables.cbt_attempt_security_logs[0].metadata;
    assert.equal(metadata.source, 'student');
    assert.equal(metadata.actor_id, user.id);
    assert.equal(metadata.client_event_id, id);
    assert.equal(metadata.timestamp, now);
    await assert.rejects(proctor.logViolation(user, 'attempt', 'exit_fullscreen', {}, id), e => e.getStatus() === 400);
    assert.equal(db.tables.cbt_attempt_security_logs.length, 1);
});
