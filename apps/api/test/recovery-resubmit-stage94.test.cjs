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
    const result = await submitFrozen(service, first.recoveryUntil);
    assert.equal(result.savedAnswersOnly, false);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
    assert.deepEqual(db.tables.cbt_answers.map(row => row.question_id).sort(), ['q1', 'q2']);
});

test('a copy locked with the original deadline is accepted after resetting a still-running attempt', async () => {
    const { db, service, proctor } = fixture('in_progress');
    await proctor.resetAttempt({ id: 'proctor' }, 'attempt', 'Reset sebelum penutupan otomatis', 15);
    assert.notEqual(db.tables.cbt_exam_attempts[0].metadata.recovery_submit_only, true);
    const result = await submitFrozen(service, originalDeadline);
    assert.equal(result.savedAnswersOnly, false);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
    assert.equal(db.tables.cbt_answers.find(row => row.question_id === 'q2').essay_answer, 'written offline');
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
