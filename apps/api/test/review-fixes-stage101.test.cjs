const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');
const { recoveryLabel } = require('../../web/lib/student-schedule.ts');

// Perbaikan temuan pemeriksaan independen jalur pengumpulan/pemulihan.
const user = { id: 'student', isPlatformAdmin: false };
const grading = { gradeAttemptFromSavedAnswers: async () => null, applyRelativeQuizScoringIfQuiz: async () => {}, retryPendingAutoSubmissions: async () => ({ recovered: 0, failed: 0 }) };
const web = file => fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');

function fixture({ status = 'in_progress', now = '2026-10-24T00:30:00Z', deadline = '2026-10-24T01:00:00Z', metadata = {} } = {}) {
    let clock = now;
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', organization_id: 'school', question_bank_id: 'bank', is_published: true,
            start_time: '2026-10-24T00:00:00Z', end_time: '2026-10-24T04:00:00Z', duration_minutes: 60, metadata: { is_public: true } }],
        cbt_organization_members: [{ user_id: user.id, organization_id: 'school', is_active: true }],
        cbt_exam_question_snapshots: [{ exam_id: 'exam', question_snapshot: { id: 'q1', type: 'essay', bank_question_options: [] } }],
        cbt_exam_attempts: [{ id: 'attempt', exam_id: 'exam', user_id: user.id, status, started_at: '2026-10-24T00:00:00Z',
            personal_end_time: deadline, device_fingerprint: 'old-device', metadata }],
        cbt_answers: [], cbt_attempt_security_logs: [],
    });
    db.raw = async sql => /clock_timestamp|select now/i.test(sql) ? [{ now: new Date(clock) }] : [{ id: 'locked' }];
    return { db, attempts: new ExamAttemptsService(db, {}, grading), proctor: new ProctoringService(db, { assertExamStaff: async () => {} }, grading),
        setNow: value => { clock = value; } };
}

test('after "move to a new device" the old device cannot take the exam back, even before the new one opens it', async () => {
    const { db, attempts, proctor } = fixture();
    await proctor.resetAttempt({ id: 'proctor' }, 'attempt', 'Laptop lama rusak', 30, true);
    assert.deepEqual(db.tables.cbt_exam_attempts[0].metadata.released_devices, ['old-device']);
    // Tab lama memuat ulang dirinya dan mencoba mengikat kunci yang kosong.
    const old = await attempts.start(user, 'exam', 'old-device');
    assert.equal(old.started, false);
    assert.match(old.error, /dipindahkan pengawas ke perangkat lain/);
    assert.equal(db.tables.cbt_exam_attempts[0].device_fingerprint, null);
    await assert.rejects(proctor.heartbeat(user, 'attempt', 'old-device'), /dipindahkan pengawas/);
    await assert.rejects(attempts.saveAnswer(user, 'attempt', { questionId: 'q1', essay_answer: 'x', revision: 1 }, 'old-device'));
    const fresh = await attempts.start(user, 'exam', 'new-device');
    assert.equal(fresh.started, true, fresh.error);
    assert.equal(db.tables.cbt_exam_attempts[0].device_fingerprint, 'new-device');
});

test('a makeup restart clears the released-device list', async () => {
    const { db, proctor } = fixture();
    await proctor.resetAttempt({ id: 'proctor' }, 'attempt', 'Laptop lama rusak', 30, true);
    await proctor.startMakeupAttempt({ id: 'proctor' }, 'attempt', 'Ujian ulang resmi', 60);
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.released_devices, undefined);
});

test('resetting a still-running attempt whose deadline already passed defaults to send-only', async () => {
    const { db, proctor } = fixture({ now: '2026-10-24T01:05:00Z' });
    const result = await proctor.resetAttempt({ id: 'proctor' }, 'attempt', 'Penutupan otomatis belum berjalan', 30);
    assert.equal(result.submitOnly, true);
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.recovery_submit_only, true);
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.recovery_source_deadline, '2026-10-24T01:00:00Z');
});

test('a lapsed recovery window says to reopen recovery, not "closed by violation"', async () => {
    const { attempts } = fixture({ status: 'auto_submitted', now: '2026-10-24T02:00:00Z', deadline: '2026-10-24T01:45:00Z',
        metadata: { closed_by_expiry: true, recovery_submit_only: true, proctor_recovery_until: '2026-10-24T01:45:00Z',
            recovery_source_deadline: '2026-10-24T01:00:00Z' } });
    await assert.rejects(attempts.submit(user, 'exam', { q1: 'local' }, undefined, 'attempt', 'old-device', { q1: 1 },
        { startedAt: '2026-10-24T00:00:00Z', personalEndTime: '2026-10-24T01:00:00Z' }),
        error => /membuka pemulihan/.test(error.message) && !/pelanggaran/.test(error.message));
});

test('a makeup attempt under send-only recovery is labelled "Kirim Jawaban"', () => {
    assert.equal(recoveryLabel({ isMakeup: true, recoverySubmitOnly: true }).button, 'Kirim Jawaban');
    assert.equal(recoveryLabel({ isMakeup: true }).button, 'Kerjakan Susulan');
});

test('the exam page never deletes an unproven local copy and re-checks generations and recovery', () => {
    const page = web('app/components/questions/ExamPage.tsx');
    // Salinan hanya disisihkan bila terbukti generasi lama, dan selalu diarsipkan dulu.
    assert.match(page, /readExamRecoverySession\(examId\)\.catch\(\(\) => null\)/);
    assert.match(page, /if \(staleCopy\) \{\s*await archiveExamSnapshot\(result\.attempt\.id\);\s*await removeExamSnapshot/);
    assert.doesNotMatch(page, /makeup_activated_at !== makeupActivatedAt\) \{\s*await removeExamSnapshot/);
    assert.match(page, /writeExamSnapshotGeneration\(result\.attempt\.id, result\.attempt\.started_at\)/);
    // Pemeriksaan ulang offline: generasi baru dimuat ulang; minta berbagi layar bukan "sesi ditutup".
    assert.match(page, /Date\.parse\(result\.attempt\.started_at\) !== Date\.parse\(localAttempt\.started_at\)\) \{\s*window\.location\.reload\(\)/);
    assert.match(page, /\/Bagikan seluruh layar\/i\.test\(result\.error \|\| ''\)/);
    // Setelah ditolak, halaman memeriksa apakah proktor membuka pemulihan lagi.
    assert.match(page, /if \(!reopened\) \{ seenClosed = true; return; \}\s*if \(seenClosed\) window\.location\.reload\(\)/);
    const storage = web('lib/exam-durable-storage.ts');
    assert.match(storage, /export async function archiveExamSnapshot/);
    assert.match(web('app/components/monitoring/ResetExamModal.tsx'), /attempt\.remaining_seconds <= 0/);
});

test('device binding locks the row and merges metadata instead of overwriting it', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/students/exam-attempts.service.ts'), 'utf8');
    assert.match(source, /FOR UPDATE', attempt\.id\);\s*const \{ data: fresh \}/);
    assert.match(source, /const metadata = \{ \.\.\.\(fresh\.metadata \|\| \{\}\), device_bound: deviceBound \};/);
});
