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

test('expired frozen payloads require proctor recovery and cannot change saved answers', async () => {
    for (const status of ['in_progress', 'auto_submitted']) {
        const { db, service } = fixture(status);
        await assert.rejects(submit(service), error => error.getStatus() === 403);
        assert.equal(db.tables.cbt_answers.length, 0);
        assert.equal(db.tables.cbt_exam_attempts[0].status, status);
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
    assert.equal(Date.parse(db.tables.cbt_exam_attempts[0].metadata.scoring_finished_at), Date.parse(db.tables.cbt_exam_attempts[0].metadata.recovery_source_deadline));
});

test('monitoring expiry requires staff approval for offline submission', async () => {
    const { db, service } = fixture();
    const monitor = new ExamMonitoringService(db, {}, {}, grading, {});
    await monitor.finalizeExpired('exam');
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.closed_by_expiry, true);
    await assert.rejects(submit(service), error => error.getStatus() === 403);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'auto_submitted');
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
        await assert.rejects(freezeExamSnapshot('frozen-test', { ...draft, answers: { q: 'different retry' }, frozenSubmission: context }), /Salinan jawaban berbeda/);
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

test('browser sends the frozen context and retries after a lost response after proctor recovery', async () => {
    const { submitExamAction } = require('../../web/lib/api/students.ts');
    const { db, service } = fixture('auto_submitted');
    const proctor = new ProctoringService(db, { assertExamStaff: async () => {} }, grading);
    await proctor.resetAttempt({ id: 'proctor' }, 'attempt', 'Verified network failure', 15);
    const original = { fetch: global.fetch, window: global.window, localStorage: global.localStorage };
    global.window = {};
    global.localStorage = { getItem: () => device, setItem: () => {} };
    let loseResponse = true;
    global.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        const isIntent = url.endsWith('/submit-intent');
        const result = isIntent ? await service.beginSubmit(user, 'attempt', body.deviceId, body.submission)
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


test('frozen browser submission can finish after deadline when its server intent was timely', async () => {
    const { db, service } = fixture();
    let now = '2026-09-20T00:59:59Z';
    db.raw = async sql => /clock_timestamp/.test(sql) ? [{ now: new Date(now) }] : [];
    await service.beginSubmit(user, 'attempt', device, { answers: { q: 'written offline' },
        answerRevisions: { q: 1 }, frozenSubmission: context });
    now = '2026-09-20T01:00:01Z';
    const result = await submit(service);
    assert.equal(result.savedAnswersOnly, false);
    assert.equal(db.tables.cbt_answers[0].essay_answer, 'written offline');
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.scoring_finished_at, db.tables.cbt_exam_attempts[0].metadata.submit_intent_at);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
});

test('frozen upload grace rejects expired, late and future intent timestamps', async () => {
    for (const intent of ['2026-09-20T00:58:01Z', '2026-09-20T01:00:00Z', '2026-09-20T01:00:02Z']) {
        const { db, service } = fixture();
        db.tables.cbt_exam_attempts[0].metadata.submit_intent_at = intent;
        db.raw = async sql => /clock_timestamp/.test(sql) ? [{ now: new Date('2026-09-20T01:00:01Z') }] : [];
        await assert.rejects(submit(service), error => error.getResponse().code === 'RECOVERY_REQUIRED');
        assert.equal(db.tables.cbt_answers.length, 0);
    }
});

test('timely intent does not extend a proctor recovery window or reopen a closed attempt', async () => {
    for (const recovery of [false, true]) {
        const { db, service } = fixture(recovery ? 'in_progress' : 'auto_submitted');
        Object.assign(db.tables.cbt_exam_attempts[0].metadata, {
            submit_intent_at: '2026-09-20T00:59:59Z', recovery_submit_only: recovery,
            ...(recovery ? { recovery_source_deadline: context.personalEndTime } : {}),
        });
        db.raw = async sql => /clock_timestamp/.test(sql) ? [{ now: new Date('2026-09-20T01:00:01Z') }] : [];
        await assert.rejects(submit(service), error => error.getStatus() === 403);
        assert.equal(db.tables.cbt_answers.length, 0);
    }
});


function submittedFixture() {
    const result = fixture('submitted');
    result.db.tables.cbt_answers.push({ attempt_id: 'attempt', question_id: 'q', essay_answer: 'stored',
        selected_option_id: null, metadata: { answer_revision: 2 } });
    result.db.tables.cbt_exam_attempts[0].metadata.assignment_submission = {
        fileUrls: ['/stored.pdf'], textSubmission: 'note', documentUrl: 'https://example.com/doc',
    };
    return result;
}

test('submitted status never verifies missing answers, different contents or different revisions', async () => {
    for (const [answers, revisions] of [
        [{ q: 'stored', extra: 'missing' }, { q: 2, extra: 1 }],
        [{ q: 'changed' }, { q: 2 }],
        [{ q: 'stored' }, { q: 3 }],
        [{ q: '' }, { q: 2 }],
    ]) {
        const { db, service } = submittedFixture();
        const result = await service.submit(user, 'exam', answers, undefined, 'attempt', device, revisions, context);
        assert.equal(result.alreadySubmitted, true);
        assert.equal(result.submissionVerified, false);
        assert.equal(result.verifiedAttemptId, undefined);
        assert.equal(db.tables.cbt_answers.length, 1);
        assert.equal(db.tables.cbt_answers[0].essay_answer, 'stored');
    }
});

test('verification compares attachment URLs and notes, not just their counts', async () => {
    for (const patch of [{ fileUrls: ['/different.pdf'] }, { textSubmission: 'different' }, { documentUrl: '' }]) {
        const { db, service } = submittedFixture();
        const assignment = { ...db.tables.cbt_exam_attempts[0].metadata.assignment_submission, ...patch };
        const result = await service.submit(user, 'exam', { q: 'stored' }, assignment, 'attempt', device, { q: 2 }, context);
        assert.equal(result.submissionVerified, false);
    }
});

test('identical retries verify persisted contents even when assignment property order differs', async () => {
    const { service } = submittedFixture();
    const assignment = { documentUrl: 'https://example.com/doc', textSubmission: 'note', fileUrls: ['/stored.pdf'] };
    const result = await service.submit(user, 'exam', { q: 'stored' }, assignment, 'attempt', device, { q: 2 }, context);
    assert.equal(result.submissionVerified, true);
    assert.equal(result.verifiedAttemptId, 'attempt');
});

test('verification read failure cannot acknowledge a submitted attempt', async () => {
    const { db, service } = submittedFixture();
    const original = db.from;
    db.from = table => table === 'cbt_answers' ? {
        select() { return this; }, eq() { return Promise.resolve({ data: null, error: { message: 'unavailable' } }); },
    } : original(table);
    await assert.rejects(service.submit(user, 'exam', { q: 'stored' }, undefined, 'attempt', device, { q: 2 }, context),
        error => error.getStatus() === 503);
});

test('browser rejects the reproduced false success and accepts only an exact verified retry', async () => {
    const { submitExamAction } = require('../../web/lib/api/students.ts');
    const { service } = submittedFixture();
    const original = { fetch: global.fetch, window: global.window, localStorage: global.localStorage };
    global.window = {};
    global.localStorage = { getItem: () => device, setItem: () => {} };
    global.fetch = async (url, init) => {
        const b = JSON.parse(init.body);
        const result = url.endsWith('/submit-intent') ? await service.beginSubmit(user, 'attempt', b.deviceId, b.submission)
            : await service.submit(user, 'exam', b.answers, b.assignmentData, b.attemptId, b.deviceId, b.answerRevisions, b.frozenSubmission);
        return new Response(JSON.stringify({ success: true, ...result }));
    };
    try {
        const rejected = await submitExamAction('exam', { q: 'new', extra: 'missing' }, { fileUrls: ['/new.pdf'] }, 'attempt', { q: 3, extra: 1 }, context);
        assert.equal(rejected.success, false);
        assert.equal(rejected.retryable, false);
        assert.match(rejected.error, /belum terverifikasi lengkap/);
        const accepted = await submitExamAction('exam', { q: 'stored' }, undefined, 'attempt', { q: 2 }, context);
        assert.equal(accepted.success, true);
        assert.equal(accepted.submissionVerified, true);
        for (const receipt of [{}, { submissionVerified: true, verifiedAttemptId: 'other' }]) {
            global.fetch = async () => new Response(JSON.stringify({ success: true, ...receipt }));
            assert.equal((await submitExamAction('exam', { q: 'stored' }, undefined, 'attempt', { q: 2 }, context)).success, false);
        }
    } finally {
        global.fetch = original.fetch;
        if (original.window === undefined) delete global.window; else global.window = original.window;
        if (original.localStorage === undefined) delete global.localStorage; else global.localStorage = original.localStorage;
    }
});


test('grace accepts only precommitted answers, revisions, attachments and context', async () => {
    for (const mutation of ['answer', 'revision', 'attachment', 'context', 'drop-context']) {
        const { db, service } = fixture();
        let now = '2026-09-20T00:59:59Z';
        db.raw = async sql => /clock_timestamp/.test(sql) ? [{ now: new Date(now) }] : [];
        const payload = { answers: { q: 'before deadline' }, answerRevisions: { q: 1 },
            assignmentData: { fileUrls: ['/before.pdf'], textSubmission: 'before' }, frozenSubmission: context };
        await service.beginSubmit(user, 'attempt', device, payload);
        const storedDigest = db.tables.cbt_exam_attempts[0].metadata.submit_intent_digest;
        now = '2026-09-20T01:00:30Z';
        const altered = structuredClone(payload);
        if (mutation === 'answer') altered.answers.q = 'changed AFTER deadline';
        if (mutation === 'revision') altered.answerRevisions.q = 2;
        if (mutation === 'attachment') altered.assignmentData.fileUrls = ['/after.pdf'];
        if (mutation === 'context') altered.frozenSubmission.personalEndTime = '2026-09-20T01:05:00Z';
        if (mutation === 'drop-context') delete altered.frozenSubmission;
        await assert.rejects(service.beginSubmit(user, 'attempt', device, altered), e => e.getStatus() === 409);
        assert.equal(db.tables.cbt_exam_attempts[0].metadata.submit_intent_digest, storedDigest);
        if (mutation === 'drop-context') {
            const result = await service.submit(user, 'exam', altered.answers, altered.assignmentData, 'attempt', device, altered.answerRevisions);
            assert.equal(result.submissionVerified, false);
        } else {
            await assert.rejects(service.submit(user, 'exam', altered.answers, altered.assignmentData, 'attempt', device,
                altered.answerRevisions, altered.frozenSubmission), e => e.getStatus() === 403);
            const retry = await service.submit(user, 'exam', payload.answers, payload.assignmentData, 'attempt', device,
                payload.answerRevisions, payload.frozenSubmission);
            assert.equal(retry.submissionVerified, true);
            assert.equal(db.tables.cbt_answers[0].essay_answer, 'before deadline');
        }
    }
});

test('a legacy unbound intent cannot authorize post-deadline changes or acquire a late commitment', async () => {
    for (const frozen of [undefined, context]) {
        const { db, service } = fixture();
        let now = '2026-09-20T00:59:59Z';
        db.raw = async sql => /clock_timestamp/.test(sql) ? [{ now: new Date(now) }] : [];
        await service.beginSubmit(user, 'attempt', device);
        now = '2026-09-20T01:00:30Z';
        const payload = { answers: { q: 'late' }, answerRevisions: { q: 1 }, frozenSubmission: frozen };
        const intent = await service.beginSubmit(user, 'attempt', device, payload);
        assert.equal(intent.savedAnswersOnly, true);
        assert.equal(db.tables.cbt_exam_attempts[0].metadata.submit_intent_digest, null);
        if (frozen) await assert.rejects(submit(service), e => e.getStatus() === 403);
        else assert.equal((await service.submit(user, 'exam', payload.answers, undefined, 'attempt', device, payload.answerRevisions)).submissionVerified, false);
        assert.equal(db.tables.cbt_answers.length, 0);
    }
});

test('equivalent reordered payload retries retain the original commitment time', async () => {
    const { db, service } = fixture();
    let now = '2026-09-20T00:59:59Z';
    db.raw = async sql => /clock_timestamp/.test(sql) ? [{ now: new Date(now) }] : [];
    const initial = await service.beginSubmit(user, 'attempt', device, { answers: { q: 'same' },
        assignmentData: { fileUrls: ['/a.pdf'], textSubmission: 'same' }, answerRevisions: { q: 1 }, frozenSubmission: context });
    now = '2026-09-20T01:00:30Z';
    const retry = await service.beginSubmit(user, 'attempt', device, { frozenSubmission: { personalEndTime: context.personalEndTime, startedAt: context.startedAt },
        answerRevisions: { q: 1 }, assignmentData: { textSubmission: 'same', fileUrls: ['/a.pdf'] }, answers: { q: 'same' } });
    assert.equal(retry.startedAt, initial.startedAt);
});
