const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');
const { ExamMonitoringService } = require('../src/proctor/exam-monitoring.service.ts');
const { attemptHealth } = require('../src/common/attempt-health.ts');
const { connectionLostAtClose } = require('../src/common/exam-monitoring.ts');
const { createExamSubmissionWorker, submissionRetryDelay } = require('../../web/lib/exam-submission-worker.ts');

const user = { id: 'student' }, device = 'bound-device';
const start = '2026-09-20T00:00:00.000Z', end = '2026-09-20T01:00:00.000Z';
const id = '0a78af61-cd0c-44d9-bbec-e169e1b4ac83';
const id2 = '55b83e30-3b53-4ce6-a996-daaef920b930';
const id3 = 'fc82e016-9543-41bb-bdc6-664488a53f30';
const frozen = { startedAt: start, personalEndTime: end };
const grading = { gradeAttemptFromSavedAnswers: async () => null, applyRelativeQuizScoringIfQuiz: async () => {},
    retryPendingAutoSubmissions: async () => {} };
const read = file => fs.readFileSync(path.resolve(__dirname, file), 'utf8');

function fixture(now, attemptPatch = {}) {
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', question_bank_id: 'bank', duration_minutes: 60, end_time: end,
            metadata: { screenshot_enabled: false, max_violations: 3 } }],
        cbt_exam_attempts: [{ id: 'attempt', exam_id: 'exam', user_id: user.id, status: 'in_progress',
            started_at: start, personal_end_time: end, device_fingerprint: device, metadata: {},
            last_seen_at: '2026-09-20T00:50:00.000Z', warning_count: 0, tab_switch_count: 0, ...attemptPatch }],
        cbt_exam_question_snapshots: [{ exam_id: 'exam', question_snapshot: { id: 'q', type: 'essay', bank_question_options: [] } }],
        cbt_answers: [], cbt_attempt_security_logs: [], cbt_exam_screenshots: [],
    }, [], { now });
    const service = new ExamAttemptsService(db, { post: async () => { throw new Error('scoring offline'); } }, grading);
    const proctor = new ProctoringService(db, {}, grading);
    const monitor = new ExamMonitoringService(db, {}, {}, grading, {});
    return { db, service, proctor, monitor };
}
const event = (eventId, createdAt) => ({ id: eventId, eventType: 'tab_switch', metadata: { timestamp: createdAt }, createdAt });
const logs = db => db.tables.cbt_attempt_security_logs;

test('expiry while the device is out of contact leaves an auditable close record', async () => {
    const { db, monitor } = fixture('2026-09-20T01:02:00.000Z');
    await monitor.finalizeExpired('exam');
    const attempt = db.tables.cbt_exam_attempts[0];
    assert.equal(attempt.status, 'auto_submitted');
    assert.equal(attempt.metadata.closed_by_expiry, true);
    assert.equal(attempt.metadata.connection_lost_at_close.gap_seconds, 600);
    assert.deepEqual(logs(db).map(log => log.event_type), ['CONNECTION_LOST_AT_CLOSE']);
    assert.equal(logs(db)[0].metadata.source, 'server_monitoring');
    assert.equal(attempt.warning_count, 0, 'a lost connection is evidence, not a violation');

    const online = fixture('2026-09-20T01:02:00.000Z', { last_seen_at: '2026-09-20T00:59:40.000Z' });
    await online.monitor.finalizeExpired('exam');
    assert.equal(online.db.tables.cbt_exam_attempts[0].metadata.connection_lost_at_close, undefined);
    assert.equal(logs(online.db).length, 0);
    assert.equal(connectionLostAtClose(null, Date.parse(end), new Date(end)), null);
});

test('violations recorded offline still reach the server after expiry, as uncounted late evidence', async () => {
    const { db, service, monitor } = fixture('2026-09-20T01:02:00.000Z');
    await monitor.finalizeExpired('exam');
    const before = structuredClone(db.tables.cbt_exam_attempts[0]);
    const result = await service.beginSubmit(user, 'attempt', device, {
        answers: { q: 'offline' }, answerRevisions: { q: 1 }, frozenSubmission: frozen,
        securityEvents: [event(id, '2026-09-20T00:55:00.000Z'), event(id2, '2026-09-20T01:30:00.000Z')],
    });
    assert.equal(result.alreadySubmitted, true);
    assert.deepEqual(result.acceptedSecurityEventIds, [id], 'events after the attempt closed are not evidence');
    const late = logs(db).filter(log => log.event_type === 'LATE_SECURITY_EVIDENCE');
    assert.equal(late.length, 1);
    assert.equal(late[0].metadata.original_event_type, 'tab_switch');
    assert.equal(late[0].metadata.late_reason, 'after_close');
    assert.deepEqual(db.tables.cbt_exam_attempts[0], before, 'counters, status and scores stay untouched');

    // Replays are idempotent and other actors cannot attach evidence.
    const replay = await service.beginSubmit(user, 'attempt', device, {
        answers: { q: 'offline' }, securityEvents: [event(id, '2026-09-20T00:55:00.000Z')] });
    assert.deepEqual(replay.acceptedSecurityEventIds, [id]);
    assert.equal(logs(db).filter(log => log.event_type === 'LATE_SECURITY_EVIDENCE').length, 1);
    await assert.rejects(service.beginSubmit({ id: 'other' }, 'attempt', device, { answers: {}, securityEvents: [event(id3, '2026-09-20T00:56:00.000Z')] }));
});

test('the live evidence outbox gets the same late-evidence treatment after expiry', async () => {
    const { db, proctor, monitor } = fixture('2026-09-20T01:02:00.000Z');
    await monitor.finalizeExpired('exam');
    const first = await proctor.logViolation(user, 'attempt', 'tab_switch', { timestamp: '2026-09-20T00:58:00.000Z' }, id);
    assert.equal(first.lateEvidence, true);
    assert.equal(first.warningCount, 0);
    const again = await proctor.logViolation(user, 'attempt', 'tab_switch', { timestamp: '2026-09-20T00:58:00.000Z' }, id);
    assert.equal(again.duplicate, true);
    await assert.rejects(proctor.logViolation(user, 'attempt', 'exit_fullscreen', { timestamp: '2026-09-20T00:58:00.000Z' }, id),
        error => error.getStatus() === 400, 'a reused ID cannot change its event type');
    await assert.rejects(proctor.logViolation(user, 'attempt', 'tab_switch', {}, id2), error => error.getStatus() === 400);
    assert.equal(db.tables.cbt_exam_attempts[0].warning_count, 0);
});

test('a submitted attempt (online, with a full manifest) does not accept new evidence', async () => {
    const { db, service } = fixture('2026-09-20T00:40:00.000Z', { status: 'submitted', finished_at: '2026-09-20T00:30:00.000Z' });
    const result = await service.beginSubmit(user, 'attempt', device, { answers: {}, securityEvents: [event(id, '2026-09-20T00:20:00.000Z')] });
    assert.deepEqual(result.acceptedSecurityEventIds, []);
    assert.equal(logs(db).length, 0);
});

test('offline answers rejected after the deadline are reported to the proctor by count, then cleared on verified delivery', async () => {
    const { db, service, monitor } = fixture('2026-09-20T01:02:00.000Z');
    db.tables.cbt_answers.push({ attempt_id: 'attempt', question_id: 'q', essay_answer: 'synced before outage', metadata: { answer_revision: 1 } });
    await monitor.finalizeExpired('exam');
    await assert.rejects(service.submit(user, 'exam', { q: 'written offline', q2: '' }, undefined, 'attempt', device, { q: 2 }, frozen),
        error => error.getResponse().code === 'RECOVERY_REQUIRED');
    const flag = db.tables.cbt_exam_attempts[0].metadata.local_answers_not_counted;
    assert.equal(flag.count, 1, 'empty values and answers already on the server are not counted');
    assert.equal(JSON.stringify(db.tables.cbt_exam_attempts[0].metadata).includes('written offline'), false);
    assert.deepEqual(logs(db).filter(log => log.event_type === 'LOCAL_ANSWERS_NOT_COUNTED').map(log => log.metadata.pendingAnswerCount), [1]);
    // Retrying the same payload does not duplicate the monitoring entry.
    await assert.rejects(service.submit(user, 'exam', { q: 'written offline' }, undefined, 'attempt', device, { q: 2 }, frozen));
    assert.equal(logs(db).filter(log => log.event_type === 'LOCAL_ANSWERS_NOT_COUNTED').length, 1);
    // Someone else's device cannot plant a report.
    const other = fixture('2026-09-20T01:02:00.000Z', { status: 'auto_submitted', metadata: { closed_by_expiry: true } });
    await assert.rejects(other.service.submit(user, 'exam', { q: 'x' }, undefined, 'attempt', 'another-device', { q: 1 }, frozen));
    assert.equal(other.db.tables.cbt_exam_attempts[0].metadata.local_answers_not_counted, undefined);

    const open = fixture('2026-09-20T00:30:00.000Z', { metadata: { local_answers_not_counted: { count: 2 } } });
    await open.service.beginSubmit(user, 'attempt', device, { answers: { q: 'final' }, answerRevisions: { q: 1 }, frozenSubmission: frozen });
    const delivered = await open.service.submit(user, 'exam', { q: 'final' }, undefined, 'attempt', device, { q: 1 }, frozen);
    assert.equal(delivered.submissionVerified, true);
    assert.equal(open.db.tables.cbt_exam_attempts[0].metadata.local_answers_not_counted, undefined);
});

test('monitoring surfaces every offline trace as an attention reason and a structured review', () => {
    const attempt = { status: 'auto_submitted', started_at: start, personal_end_time: end, total_score: 70,
        metadata: { closed_by_expiry: true, connection_lost_at_close: { last_seen_at: '2026-09-20T00:50:00.000Z', deadline_at: end, gap_seconds: 600 },
            local_answers_not_counted: { count: 3, reported_at: '2026-09-20T01:05:00.000Z' } } };
    const history = [
        { event_type: 'LATE_SECURITY_EVIDENCE', created_at: '2026-09-20T01:05:00.000Z', metadata: {} },
        { event_type: 'LATE_SECURITY_EVIDENCE', created_at: '2026-09-20T00:10:00.000Z', metadata: {} },
        { event_type: 'RESET_BY_PROCTOR', created_at: '2026-09-20T00:20:00.000Z', metadata: {} },
    ];
    const health = attemptHealth(attempt, { end_time: end, duration_minutes: 60 }, [], new Date('2026-09-20T01:10:00Z'), 5, history);
    assert.ok(health.attention_reasons.includes('Perangkat tanpa kontak saat waktu habis'));
    assert.ok(health.attention_reasons.includes('3 jawaban lokal belum masuk — perlu pemulihan'));
    assert.ok(health.attention_reasons.includes('Ada catatan pengawasan susulan dari masa offline'));
    assert.equal(health.offline_review.late_security_evidence, 1, 'evidence reviewed before the last reset is not repeated');
    // After a recovery reset the expiry flag no longer applies.
    const reopened = attemptHealth({ ...attempt, status: 'in_progress', metadata: { connection_lost_at_close: attempt.metadata.connection_lost_at_close } },
        { end_time: end, duration_minutes: 60 }, [], new Date('2026-09-20T00:30:00Z'), 5);
    assert.equal(reopened.offline_review.connection_lost_at_close, null);
});

test('makeup exams drop the offline flags of the deleted generation', () => {
    const source = read('../src/proctoring/proctoring.service.ts');
    assert.match(source, /delete previousMetadata\.connection_lost_at_close;\s+delete previousMetadata\.local_answers_not_counted;/);
});

test('the delivery queue backs off on proctor-only rejections and discards generations replaced by a makeup exam', async () => {
    assert.equal(submissionRetryDelay(1, true), 15_000);
    assert.equal(submissionRetryDelay(5, true), 60_000);
    assert.equal(submissionRetryDelay(1, false), 120_000);
    assert.equal(submissionRetryDelay(9, false), 600_000);
    const entry = { attemptId: 'attempt', examId: 'exam', userId: 'student', deviceId: 'device-id', deadlineAt: 1000,
        assignment: false, startedAt: start, personalEndTime: end };
    const calls = [];
    const worker = createExamSubmissionWorker({
        online: () => true, now: () => 2000, activeExamId: () => null, list: async () => [entry],
        currentUser: async () => ({ id: 'student' }), currentDevice: async () => 'device-id',
        read: async () => ({ answers: { q: 'old generation' }, doubtfulAnswers: [] }),
        status: async () => ({ success: true, examId: 'exam', status: 'in_progress', remainingSeconds: 3600, canRecover: true,
            startedAt: '2026-09-21T00:00:00.000Z', personalEndTime: '2026-09-21T01:00:00.000Z' }),
        assignment: () => undefined, freeze: async (_, s) => s,
        send: async () => { calls.push('send'); return { success: true }; },
        confirm: async () => { calls.push('confirm'); },
        discard: async () => { calls.push('discard'); },
    });
    await worker.run();
    assert.deepEqual(calls, ['discard']);
});

test('shared devices: offline packages need the last server-verified owner and every logout clears them', async () => {
    const examPage = read('../../web/app/components/questions/ExamPage.tsx');
    assert.match(examPage, /const ownerId = knownUserId \?\? readExamOfflineOwner\(\);/);
    assert.match(examPage, /userId: ownerId,/);
    assert.match(examPage, /rememberExamOfflineOwner\(authUser\.id\)/);
    assert.doesNotMatch(examPage, /userId: knownUserId,/);
    const singleLogout = read('../../web/app/components/SingleLogoutListener.tsx');
    assert.match(singleLogout, /forgetExamOfflineOwner\(\);[\s\S]*clearExamRecoverySessions\(\)[\s\S]*clearExamOfflineShells\(\)/);
    assert.match(read('../../web/app/components/Header.tsx'), /forgetExamOfflineOwner\(\);/);

    const values = new Map();
    const previous = global.localStorage;
    global.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k),
        key: i => [...values.keys()][i] ?? null, get length() { return values.size; } };
    try {
        const storage = require('../../web/lib/exam-durable-storage.ts');
        storage.rememberExamOfflineOwner('student-a');
        assert.equal(storage.readExamOfflineOwner(), 'student-a');
        storage.forgetExamOfflineOwner();
        assert.equal(storage.readExamOfflineOwner(), null);
    } finally {
        global.localStorage = previous;
    }
});

test('local answer copies expire seven days after the deadline, with their per-attempt caches', async () => {
    const values = new Map();
    const previous = global.localStorage;
    global.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k),
        key: i => [...values.keys()][i] ?? null, get length() { return values.size; } };
    try {
        const storage = require('../../web/lib/exam-durable-storage.ts');
        const now = Date.parse('2026-10-01T00:00:00Z');
        const registration = (attemptId, deadlineAt) => ({ attemptId, examId: `exam-${attemptId}`, userId: 'student', deviceId: 'd',
            startedAt: start, personalEndTime: end, deadlineAt, assignment: false });
        values.set('exam_submission_old', JSON.stringify(registration('old', now - storage.LOCAL_EXAM_COPY_MAX_AGE_MS - 1)));
        values.set('exam_submission_new', JSON.stringify(registration('new', now - 60_000)));
        for (const id of ['old', 'new']) {
            values.set(`exam_answers_${id}`, JSON.stringify({ answers: { q: id }, doubtfulAnswers: [] }));
            values.set(`exam_connection_${id}`, '{}');
            values.set(`exam_assignment_${id}`, '{}');
        }
        await storage.pruneStaleExamCopies(now);
        assert.deepEqual([...values.keys()].sort(), ['exam_answers_new', 'exam_assignment_new', 'exam_connection_new', 'exam_submission_new']);
    } finally {
        global.localStorage = previous;
    }
});

test('a lock derived from the device clock is confirmed by the server before an automatic submission', () => {
    const examPage = read('../../web/app/components/questions/ExamPage.tsx');
    assert.match(examPage, /if \(opts\?\.isAuto && clockFromDeviceRef\.current && !frozenSnapshotRef\.current &&/);
    assert.match(examPage, /status\.status === 'in_progress' && status\.remainingSeconds > 0 && !status\.submissionOnly\)\) \{\s+window\.location\.reload\(\);/);
    assert.match(examPage, /clockRef\.current\.anchor\(remaining\);\s+clockFromDeviceRef\.current = true;/);
    // Closing a terminated attempt no longer throws away the rest of the offline evidence queue.
    assert.doesNotMatch(examPage, /events\.slice\(index \+ 1\)\.map/);
});
