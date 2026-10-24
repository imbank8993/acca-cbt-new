const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');

// Kasus nyata: siswa offline saat waktu habis, salinan lokal 21 jawaban, server 12.
// Proktor memulihkan; salinan harus tetap diterima walau pemulihan diulang atau
// reset dilakukan sebelum penutupan otomatis berjalan.
const user = { id: 'student' }, device = 'original-device';
const startedAt = '2026-09-20T00:00:00Z', originalDeadline = '2026-09-20T01:00:00Z';
const grading = { gradeAttemptFromSavedAnswers: async () => null, applyRelativeQuizScoringIfQuiz: async () => {}, retryPendingAutoSubmissions: async () => ({ recovered: 0, failed: 0 }) };

function fixture(status) {
    let now = '2026-09-20T02:00:00Z';
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', question_bank_id: 'bank', duration_minutes: 60, end_time: originalDeadline }],
        cbt_exam_attempts: [{ id: 'attempt', exam_id: 'exam', user_id: user.id, status, started_at: startedAt,
            personal_end_time: originalDeadline, device_fingerprint: device,
            metadata: status === 'auto_submitted' ? { closed_by_expiry: true } : {} }],
        cbt_exam_question_snapshots: [
            { exam_id: 'exam', question_snapshot: { id: 'q1', type: 'essay', bank_question_options: [] } },
            { exam_id: 'exam', question_snapshot: { id: 'q2', type: 'essay', bank_question_options: [] } },
        ],
        cbt_answers: [{ attempt_id: 'attempt', question_id: 'q1', essay_answer: 'online', selected_option_id: null,
            metadata: { answer_revision: 1 } }],
        cbt_attempt_security_logs: [],
    });
    db.raw = async sql => /clock_timestamp|select now/i.test(sql) ? [{ now: new Date(now) }] : [{ id: 'locked' }];
    const service = new ExamAttemptsService(db, { post: async () => { throw new Error('scoring offline'); } }, grading);
    const proctor = new ProctoringService(db, { assertExamStaff: async () => {} }, grading);
    return { db, service, proctor, setNow: value => { now = value; } };
}
const offlineAnswers = { q1: 'online', q2: 'written offline' };
const submitFrozen = (service, personalEndTime) => service.submit(user, 'exam', offlineAnswers, undefined, 'attempt',
    device, { q1: 1, q2: 1 }, { startedAt, personalEndTime });

test('a copy locked during the first recovery is accepted after a second recovery', async () => {
    const { db, service, proctor, setNow } = fixture('auto_submitted');
    const first = await proctor.resetAttempt({ id: 'proctor' }, 'attempt', 'Jaringan putus saat waktu habis', 15);
    // Klien mengunci salinan dengan batas pemulihan pertama, lalu jendelanya habis.
    Object.assign(db.tables.cbt_exam_attempts[0], { status: 'auto_submitted', finished_at: '2026-09-20T02:16:00Z' });
    db.tables.cbt_exam_attempts[0].metadata.closed_by_expiry = true;
    setNow('2026-09-20T02:30:00Z');
    await proctor.resetAttempt({ id: 'proctor' }, 'attempt', 'Pemulihan diulang', 15);
    const attempt = db.tables.cbt_exam_attempts[0];
    assert.equal(attempt.metadata.recovery_source_deadline, originalDeadline);
    assert.ok(attempt.metadata.superseded_deadlines.includes(first.recoveryUntil));
    assert.equal(db.tables.cbt_attempt_security_logs[0].metadata.attempt_started_at, startedAt);
    const result = await submitFrozen(service, first.recoveryUntil);
    assert.equal(result.savedAnswersOnly, false);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
    assert.deepEqual(db.tables.cbt_answers.map(row => row.question_id).sort(), ['q1', 'q2']);
});

test('a copy locked with the original deadline is accepted after resetting a still-running attempt', async () => {
    // Tenggat sudah lewat tetapi penutupan otomatis belum berjalan: bawaannya kini
    // "kirim saja" (stage101), dan pilihan eksplisit "lanjutkan mengerjakan" tetap ada.
    for (const submitOnly of [undefined, false]) {
        const { db, service, proctor } = fixture('in_progress');
        await proctor.resetAttempt({ id: 'proctor' }, 'attempt', 'Reset sebelum penutupan otomatis', 15, false, submitOnly);
        assert.equal(db.tables.cbt_exam_attempts[0].metadata.recovery_submit_only, submitOnly === undefined);
        const result = await submitFrozen(service, originalDeadline);
        assert.equal(result.savedAnswersOnly, false);
        assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
        assert.equal(db.tables.cbt_answers.find(row => row.question_id === 'q2').essay_answer, 'written offline');
    }
});

test('an unrelated deadline, another device or another session generation is still refused', async () => {
    for (const [ctx, fromDevice] of [
        [{ startedAt, personalEndTime: '2026-09-20T05:00:00Z' }, device],
        [{ startedAt, personalEndTime: originalDeadline }, 'other-device'],
        [{ startedAt: '2026-09-19T00:00:00Z', personalEndTime: originalDeadline }, device],
    ]) {
        const { db, service, proctor } = fixture('auto_submitted');
        await proctor.resetAttempt({ id: 'proctor' }, 'attempt', 'Jaringan putus saat waktu habis', 15);
        await assert.rejects(service.submit(user, 'exam', offlineAnswers, undefined, 'attempt', fromDevice, { q1: 1, q2: 1 }, ctx));
        assert.equal(db.tables.cbt_answers.length, 1);
        assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
    }
});

test('a makeup restart forgets superseded deadlines', async () => {
    const { db, proctor } = fixture('auto_submitted');
    await proctor.resetAttempt({ id: 'proctor' }, 'attempt', 'Jaringan putus saat waktu habis', 15);
    db.tables.cbt_exam_attempts[0].status = 'auto_submitted';
    await proctor.startMakeupAttempt({ id: 'proctor' }, 'attempt', 'Ujian susulan resmi', 60);
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.superseded_deadlines, undefined);
});

test('the locked recovery screen submits a local copy automatically and shows the recovery deadline', () => {
    const page = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'), 'utf8');
    assert.match(page, /if \(recoverySubmitOnly && localSnapshot && Object\.keys\(localSnapshot\.answers \|\| \{\}\)\.length > 0\) \{\s*setWaitingForSyncAndSubmit\(true\);/);
    assert.match(page, /Kirim sebelum pukul/);
    assert.match(page, /Batas pemulihan pukul/);
});

function legacyRecovery() {
    const ctx = fixture('in_progress');
    const attempt = ctx.db.tables.cbt_exam_attempts[0];
    attempt.personal_end_time = '2026-09-20T02:15:00Z';
    attempt.metadata = { recovery_submit_only: true, proctor_recovery_until: attempt.personal_end_time,
        recovery_source_deadline: '2026-09-20T01:05:00Z' };
    ctx.db.tables.cbt_attempt_security_logs.push({ attempt_id: 'attempt', event_type: 'RESET_BY_PROCTOR',
        created_at: '2026-09-20T00:50:00Z', metadata: { reset_at: '2026-09-20T00:50:00.010Z',
            previous_deadline: originalDeadline, recovery_until: '2026-09-20T00:55:00Z' } });
    return ctx;
}

test('legacy reset audit restores original and intermediate deadlines for submission and confirmation', async () => {
    for (const personalEndTime of [originalDeadline, '2026-09-20T00:55:00Z']) {
        const { db, service } = legacyRecovery();
        const payload = { answers: offlineAnswers, answerRevisions: { q1: 1, q2: 1 },
            frozenSubmission: { startedAt, personalEndTime } };
        await service.beginSubmit(user, 'attempt', device, payload);
        const result = await submitFrozen(service, personalEndTime);
        assert.equal(result.submissionVerified, true);
        assert.equal(result.savedAnswersOnly, false);
        assert.equal(db.tables.cbt_answers.length, 2);
        const retry = await submitFrozen(service, personalEndTime);
        assert.equal(retry.alreadySubmitted, true);
        assert.equal(retry.submissionVerified, true);
    }
});

test('legacy deadline recognition never bypasses an expired recovery window', async () => {
    const { db, service, setNow } = legacyRecovery();
    setNow('2026-09-20T02:15:00Z');
    await assert.rejects(submitFrozen(service, originalDeadline), /Jendela pengumpulan pemulihan telah berakhir/);
    assert.equal(db.tables.cbt_answers.length, 1);
});

test('closed legacy recovery confirms only answers already stored without reopening the exam', async () => {
    for (const differs of [false, true]) {
        const { db, service } = legacyRecovery();
        db.tables.cbt_exam_attempts[0].status = 'auto_submitted';
        const answers = differs ? offlineAnswers : { q1: 'online' };
        const call = service.submit(user, 'exam', answers, undefined, 'attempt', device, { q1: 1 },
            { startedAt, personalEndTime: originalDeadline });
        if (differs) await assert.rejects(call, /Sesi ditutup/);
        else {
            const result = await call;
            assert.equal(result.submissionVerified, true);
            assert.equal(result.alreadySubmitted, true);
        }
        assert.equal(db.tables.cbt_exam_attempts[0].status, 'auto_submitted');
        assert.equal(db.tables.cbt_answers.length, 1);
    }
});

test('a makeup generation cannot reuse a previous reset even when its old deadline lies in the future', async () => {
    const { db, service, proctor, setNow } = legacyRecovery();
    // Reset from an earlier generation had a deadline later than the new start.
    const oldDeadline = '2026-09-20T05:00:00Z';
    db.tables.cbt_attempt_security_logs[0].metadata.previous_deadline = oldDeadline;
    db.tables.cbt_exam_attempts[0].status = 'auto_submitted';
    await proctor.startMakeupAttempt({ id: 'proctor' }, 'attempt', 'Ujian susulan resmi', 60);
    setNow('2026-09-20T02:01:00Z');
    // The student opens the new generation and binds the original device again.
    db.tables.cbt_exam_attempts[0].device_fingerprint = device;
    const currentStart = db.tables.cbt_exam_attempts[0].started_at;
    await assert.rejects(service.submit(user, 'exam', offlineAnswers, undefined, 'attempt', device,
        { q1: 1, q2: 1 }, { startedAt: currentStart, personalEndTime: oldDeadline }), /sesi yang sudah diganti/);
    assert.equal(db.tables.cbt_answers.length, 0);
});

test('only reset audit from this attempt and generation may recognize a missing deadline', async () => {
    for (const mutation of [
        row => { row.attempt_id = 'other-attempt'; },
        row => { row.event_type = 'MAKEUP_EXAM_STARTED'; },
        row => { row.event_type = 'tab_close'; },
        row => { row.created_at = '2026-09-19T23:50:00Z'; },
        row => { row.metadata.reset_at = '2026-09-19T23:50:00Z'; },
        row => { row.metadata.attempt_started_at = '2026-09-19T23:00:00Z'; },
        row => { delete row.metadata.reset_at; },
    ]) {
        const { db, service } = legacyRecovery();
        mutation(db.tables.cbt_attempt_security_logs[0]);
        await assert.rejects(submitFrozen(service, originalDeadline), /sesi yang sudah diganti/);
        assert.equal(db.tables.cbt_answers.length, 1);
    }
});

test('legacy audit cannot authorize another user, device, generation or invented deadline', async () => {
    for (const [who, fromDevice, context] of [
        [{ id: 'other-user' }, device, { startedAt, personalEndTime: originalDeadline }],
        [user, 'other-device', { startedAt, personalEndTime: originalDeadline }],
        [user, device, { startedAt: '2026-09-19T00:00:00Z', personalEndTime: originalDeadline }],
        [user, device, { startedAt, personalEndTime: '2026-09-20T03:00:00Z' }],
    ]) {
        const { db, service } = legacyRecovery();
        await assert.rejects(service.submit(who, 'exam', offlineAnswers, undefined, 'attempt', fromDevice,
            { q1: 1, q2: 1 }, context));
        assert.equal(db.tables.cbt_answers.length, 1);
    }
});

test('an unreadable legacy audit fails retryably without saving or confirming answers', async () => {
    const { db, service } = legacyRecovery();
    const from = db.from.bind(db);
    db.from = table => table === 'cbt_attempt_security_logs'
        ? fixtureDb({}, ['cbt_attempt_security_logs']).from(table) : from(table);
    await assert.rejects(submitFrozen(service, originalDeadline), error => error.getStatus() === 503);
    assert.equal(db.tables.cbt_answers.length, 1);
});
