const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { StudentsService } = require('../src/students/students.service.ts');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');
const { scheduleState, recoveryLabel } = require('../../web/lib/student-schedule.ts');

// Ujian 08.00–12.00 WITA. Siswa A tidak hadir; proktor membuat susulan pukul 13.00
// tanpa mengubah jadwal. Siswa B yang juga belum mengerjakan tidak boleh ikut melihatnya.
const NOW = '2026-10-24T05:00:00Z';
const grading = { gradeAttemptFromSavedAnswers: async () => null };
const web = file => fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');

function fixture(extra = {}) {
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', organization_id: 'school', is_published: true, title: 'Simulasi', duration_minutes: 120,
            start_time: '2026-10-24T00:00:00Z', end_time: '2026-10-24T04:00:00Z', metadata: { is_public: true }, ...extra }],
        cbt_organization_members: [
            { user_id: 'a', organization_id: 'school', is_active: true },
            { user_id: 'b', organization_id: 'school', is_active: true },
        ],
        cbt_profiles: [{ id: 'a', full_name: 'A' }, { id: 'b', full_name: 'B' }],
        cbt_exam_question_snapshots: [{ exam_id: 'exam', question_snapshot: { id: 'q1', type: 'essay', bank_question_options: [] } }],
        cbt_exam_attempts: [], cbt_answers: [], cbt_attempt_security_logs: [],
    }, [], { now: NOW });
    const proctor = new ProctoringService(db, { assertExamStaff: async () => {} }, grading);
    return { db, proctor };
}

test('an absent student gets a private makeup window without changing the exam schedule', async () => {
    const { db, proctor } = fixture();
    const result = await proctor.startMakeupForStudent({ id: 'proctor' }, 'exam', 'a', 'Sakit saat ujian', 120, 'req-1');
    assert.equal(result.previousStatus, 'belum');
    assert.equal(result.recoveryUntil, '2026-10-24T07:00:00.000Z');
    const [attempt] = db.tables.cbt_exam_attempts;
    assert.equal(attempt.user_id, 'a');
    assert.equal(attempt.status, 'in_progress');
    assert.equal(attempt.device_fingerprint, null);
    assert.equal(attempt.metadata.makeup_exam, true);
    assert.equal(db.tables.cbt_exams[0].end_time, '2026-10-24T04:00:00Z');
    assert.equal(db.tables.cbt_attempt_security_logs[0].event_type, 'MAKEUP_EXAM_STARTED');
    // Retry setelah respons hilang: hasil sama, tidak ada attempt kedua.
    const retry = await proctor.startMakeupForStudent({ id: 'proctor' }, 'exam', 'a', 'Sakit saat ujian', 120, 'req-1');
    assert.equal(retry.attemptId, result.attemptId);
    assert.equal(db.tables.cbt_exam_attempts.length, 1);
    // Permintaan baru untuk siswa yang sudah punya pengerjaan ditolak.
    await assert.rejects(proctor.startMakeupForStudent({ id: 'proctor' }, 'exam', 'a', 'Sakit lagi', 60, 'req-2'), /sudah memiliki pengerjaan/);
});

test('only the makeup student sees the exam open; other absent students do not', async () => {
    const { db, proctor } = fixture();
    await proctor.startMakeupForStudent({ id: 'proctor' }, 'exam', 'a', 'Sakit saat ujian', 120);
    const now = Date.parse(NOW);
    const [a] = await new StudentsService(db).listExams({ id: 'a' });
    const [b] = await new StudentsService(db).listExams({ id: 'b' });
    assert.equal(scheduleState(a, now), 'open');
    assert.equal(a.isMakeup, true);
    assert.deepEqual(recoveryLabel(a), { badge: 'Susulan', action: 'Kerjakan', button: 'Kerjakan Susulan' });
    assert.equal(scheduleState(b, now), 'closed');
    assert.equal((await new ExamAttemptsService(db, {}, grading).start({ id: 'b' }, 'exam', 'device-b')).started, false);
});

test('the makeup student goes through preparation, then starts after the schedule ended', async () => {
    const { db, proctor } = fixture();
    await proctor.startMakeupForStudent({ id: 'proctor' }, 'exam', 'a', 'Sakit saat ujian', 120);
    const students = new StudentsService(db);
    assert.equal((await students.getExamForAttempt({ id: 'a' }, 'exam')).hasStartedAttempt, false);
    const started = await new ExamAttemptsService(db, {}, grading).start({ id: 'a' }, 'exam', 'device-a');
    assert.equal(started.started, true, started.error);
    assert.equal(db.tables.cbt_exam_attempts[0].device_fingerprint, 'device-a');
    assert.ok(started.remainingSeconds > 7000);
    assert.equal((await students.getExamForAttempt({ id: 'a' }, 'exam')).hasStartedAttempt, true);
});

test('non-participants and released answer keys are refused', async () => {
    const outsider = fixture();
    await assert.rejects(outsider.proctor.startMakeupForStudent({ id: 'proctor' }, 'exam', 'stranger', 'Sakit saat ujian', 60), /bukan peserta/);
    assert.equal(outsider.db.tables.cbt_exam_attempts.length, 0);
    const released = fixture({ show_results: true, metadata: { is_public: true, show_answer_keys: true } });
    await assert.rejects(released.proctor.startMakeupForStudent({ id: 'proctor' }, 'exam', 'a', 'Sakit saat ujian', 60), /Kunci jawaban/);
    assert.equal(released.db.tables.cbt_exam_attempts.length, 0);
});

test('monitoring offers "Susulan" on not-started rows and the dialog creates a new attempt', () => {
    const monitoring = fs.readFileSync(path.resolve(__dirname, '../src/proctor/exam-monitoring.service.ts'), 'utf8');
    assert.match(monitoring, /id: `unstarted-\$\{userId\}`,[\s\S]{0,200}canReset: canReset\(userId\)/);
    assert.match(web('app/components/MonitoringHealthPanel.tsx'), /'belum'\]\.includes\(attempt\.status\)/);
    const modal = web('app/components/monitoring/ResetExamModal.tsx');
    assert.match(modal, /startMakeupForAbsentStudent\(attempt\.exam_id, attempt\.user_id, trimmedReason, duration\)/);
    assert.match(modal, /Jadwal ujian tidak berubah/);
    assert.match(web('lib/api/proctoring.ts'), /participants\/\$\{encodeURIComponent\(studentId\)\}\/makeup/);
});
