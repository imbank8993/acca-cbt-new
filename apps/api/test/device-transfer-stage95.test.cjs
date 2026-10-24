const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');
const { attemptHealth } = require('../src/common/attempt-health.ts');

// Perangkat pertama rusak di tengah ujian: proktor memindahkan siswa ke
// perangkat baru tanpa menghapus jawaban yang sudah ada di server.
const user = { id: 'student', isPlatformAdmin: false };
const grading = { gradeAttemptFromSavedAnswers: async () => null, applyRelativeQuizScoringIfQuiz: async () => {}, retryPendingAutoSubmissions: async () => ({ recovered: 0, failed: 0 }) };
const web = file => fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');

function fixture({ status = 'in_progress', screenshot = false } = {}) {
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', organization_id: 'school', question_bank_id: 'bank', is_published: true,
            start_time: '2026-09-19T23:00:00Z', end_time: '2026-09-20T01:00:00Z', duration_minutes: 60,
            metadata: { is_public: true, ...(screenshot ? { screenshot_enabled: true } : {}) } }],
        cbt_exam_attempts: [{ id: 'attempt', exam_id: 'exam', user_id: user.id, status,
            started_at: '2026-09-20T00:00:00Z', personal_end_time: '2026-09-20T01:00:00Z',
            device_fingerprint: 'device-one', warning_count: 0,
            metadata: status === 'auto_submitted'
                ? { closed_by_expiry: true, local_answers_not_counted: { count: 9, reported_at: '2026-09-20T01:01:00Z' } } : {} }],
        cbt_exam_question_snapshots: [
            { exam_id: 'exam', question_snapshot: { id: 'q1', type: 'essay', bank_question_options: [] } },
            { exam_id: 'exam', question_snapshot: { id: 'q2', type: 'essay', bank_question_options: [] } },
        ],
        cbt_answers: [{ attempt_id: 'attempt', question_id: 'q1', essay_answer: 'on server', selected_option_id: null,
            metadata: { answer_revision: 1 } }],
        cbt_attempt_security_logs: [],
        cbt_organization_members: [{ user_id: user.id, organization_id: 'school', is_active: true }],
        cbt_class_members: [], cbt_additional_class_members: [], cbt_exam_participants: [],
    }, [], { now: status === 'auto_submitted' ? '2026-09-20T01:10:00Z' : '2026-09-20T00:30:00Z' });
    const attempts = new ExamAttemptsService(db, { post: async () => { throw new Error('scoring offline'); } }, grading);
    const proctor = new ProctoringService(db, { assertExamStaff: async () => {} }, grading);
    return { db, attempts, proctor };
}

test('the old message no longer tells the student a plain reset moves the exam', async () => {
    const { attempts } = fixture();
    const refused = await attempts.start(user, 'exam', 'device-two');
    assert.equal(refused.started, false);
    assert.match(refused.error, /Lanjutkan di perangkat itu/);
    assert.match(refused.error, /Pindahkan ke perangkat baru/);
});

test('a plain recovery keeps the device lock', async () => {
    const { db, attempts, proctor } = fixture();
    await proctor.resetAttempt({ id: 'proctor' }, 'attempt', 'Jaringan putus', 15);
    assert.equal(db.tables.cbt_exam_attempts[0].device_fingerprint, 'device-one');
    assert.equal((await attempts.start(user, 'exam', 'device-two')).started, false);
});

test('moving a running attempt lets the next device continue with the server answers', async () => {
    const { db, attempts, proctor } = fixture();
    const result = await proctor.resetAttempt({ id: 'proctor' }, 'attempt', 'Laptop rusak di tengah ujian', 20, true);
    assert.equal(result.deviceReleased, true);
    const row = db.tables.cbt_exam_attempts[0];
    assert.equal(row.device_fingerprint, null);
    assert.equal(row.status, 'in_progress');
    const log = db.tables.cbt_attempt_security_logs.find(entry => entry.event_type === 'RESET_BY_PROCTOR');
    assert.equal(log.metadata.device_released, true);
    assert.equal(log.metadata.previous_device, 'device-one');

    const started = await attempts.start(user, 'exam', 'device-two');
    assert.equal(started.started, true, started.error);
    assert.equal(db.tables.cbt_exam_attempts[0].device_fingerprint, 'device-two');
    assert.deepEqual((started.answers || []).map(answer => answer.question_id), ['q1']);
    await attempts.saveAnswer(user, 'attempt', { questionId: 'q2', essay_answer: 'from new device', revision: 1 }, 'device-two', started.attempt.started_at);
    await assert.rejects(attempts.saveAnswer(user, 'attempt', { questionId: 'q2', essay_answer: 'old device', revision: 2 }, 'device-one'),
        error => /bukan perangkat ujian Anda/.test(error.message));
    assert.equal(db.tables.cbt_answers.find(answer => answer.question_id === 'q2').essay_answer, 'from new device');
    // Perangkat pertama sekarang yang ditolak.
    assert.equal((await attempts.start(user, 'exam', 'device-one')).started, false);
});

test('moving a closed attempt reopens a working session, not a submit-only one, and records abandoned local answers', async () => {
    const { db, attempts, proctor } = fixture({ status: 'auto_submitted' });
    await proctor.resetAttempt({ id: 'proctor' }, 'attempt', 'Laptop pertama mati total', 15, true);
    const row = db.tables.cbt_exam_attempts[0];
    assert.equal(row.status, 'in_progress');
    assert.equal(row.metadata.recovery_submit_only, false);
    assert.equal(row.metadata.recovery_source_deadline, undefined);
    assert.equal(row.metadata.closed_by_expiry, undefined);
    assert.equal(row.metadata.local_answers_not_counted, undefined);
    const log = db.tables.cbt_attempt_security_logs.find(entry => entry.event_type === 'RESET_BY_PROCTOR');
    assert.equal(log.metadata.abandoned_local_answers, 9);
    const started = await attempts.start(user, 'exam', 'device-two');
    assert.equal(started.started, true, started.error);
    await attempts.saveAnswer(user, 'attempt', { questionId: 'q2', essay_answer: 'continued', revision: 1 }, 'device-two', started.attempt.started_at);
    assert.equal(db.tables.cbt_answers.length, 2);
});

test('the new device must share its screen again when the exam requires it', async () => {
    const { db, proctor } = fixture({ screenshot: true });
    await proctor.resetAttempt({ id: 'proctor' }, 'attempt', 'Laptop rusak di tengah ujian', 20, true);
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.screen_share_confirmed, false);
});

test('monitoring flags blocked attempts from another device since the last reset', () => {
    const attempt = { id: 'a', status: 'in_progress', metadata: {}, last_seen_at: '2026-09-20T00:29:50Z',
        started_at: '2026-09-20T00:00:00Z', personal_end_time: '2026-09-20T01:00:00Z' };
    const logs = [
        { event_type: 'DEVICE_SWITCH_BLOCKED', created_at: '2026-09-20T00:10:00Z' },
        { event_type: 'RESET_BY_PROCTOR', created_at: '2026-09-20T00:15:00Z' },
        { event_type: 'DEVICE_SWITCH_BLOCKED', created_at: '2026-09-20T00:20:00Z' },
        { event_type: 'DEVICE_SWITCH_BLOCKED', created_at: '2026-09-20T00:25:00Z' },
    ];
    const health = attemptHealth(attempt, {}, [], new Date('2026-09-20T00:30:00Z'), 2, logs);
    assert.deepEqual(health.offline_review.other_device_attempts, { count: 2, last_at: '2026-09-20T00:25:00Z' });
    assert.ok(health.attention_reasons.some(reason => /Mencoba masuk dari perangkat lain \(2×\)/.test(reason)));
    assert.equal(attemptHealth(attempt, {}, [], new Date('2026-09-20T00:30:00Z'), 2, logs.slice(0, 2)).offline_review.other_device_attempts, null);
});

test('the reset dialog offers the device move for one student and sends it to the API', () => {
    const modal = web('app/components/monitoring/ResetExamModal.tsx');
    assert.match(modal, /Pindahkan ke perangkat baru/);
    assert.match(modal, /const moveDevice = mode === 'PULIHKAN' && releaseDevice && !participantSummary;/);
    assert.match(modal, /resetExamAttempt\(attempt\.id, trimmedReason, duration, moveDevice\)/);
    assert.match(web('lib/api/proctoring.ts'), /releaseDevice \? \{ releaseDevice: true \} : \{\}/);
    assert.match(web('app/components/monitoring/AttemptHistoryModal.tsx'), /Dipindahkan ke perangkat baru/);
});

test('permanent answer rejections are shown to the student instead of "waiting to sync"', () => {
    const page = web('app/components/questions/ExamPage.tsx');
    assert.match(page, /else if \(res\.retryable === false\) setSyncRejection/);
    assert.match(page, /jawaban ditolak server/);
    assert.equal((page.match(/noteSyncResult\(res\);/g) || []).length, 3);
    assert.match(web('app/components/questions/ExamStatusNotice.tsx'), /'amber' \| 'blue' \| 'red'/);
});
