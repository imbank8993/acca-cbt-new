const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { StudentsService } = require('../src/students/students.service.ts');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const { scheduleState, dashboardExams, recoveryActive, recoveryLabel } = require('../../web/lib/student-schedule.ts');

// Ujian 08.00–12.00; laporan gagal kirim baru diterima, proktor memulihkan
// pukul 13.00 untuk pengiriman saja. Jadwal ujian tidak perlu diubah.
const user = { id: 'student' };
const NOW = '2026-10-24T05:00:00Z'; // 13.00 WITA
const web = file => fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');

function fixture({ recoveryUntil = '2026-10-24T05:15:00Z', submitOnly = true, screenshot = false } = {}) {
    return fixtureDb({
        cbt_exams: [{ id: 'exam', organization_id: 'school', is_published: true, title: 'Simulasi',
            duration_minutes: 120, start_time: '2026-10-24T00:00:00Z', end_time: '2026-10-24T04:00:00Z',
            metadata: { is_public: true, ...(screenshot ? { screenshot_enabled: true } : {}) } }],
        cbt_organization_members: [{ user_id: user.id, organization_id: 'school', is_active: true }],
        cbt_profiles: [{ id: user.id, full_name: 'Siswa Uji' }],
        cbt_exam_attempts: [{ id: 'attempt', user_id: user.id, exam_id: 'exam', status: 'in_progress',
            started_at: '2026-10-24T00:05:00Z', personal_end_time: recoveryUntil, device_fingerprint: 'device-one',
            metadata: { proctor_recovery_until: recoveryUntil, recovery_submit_only: submitOnly,
                recovery_source_deadline: '2026-10-24T02:05:00Z' } }],
        cbt_answers: [], cbt_attempt_security_logs: [],
    }, [], { now: NOW });
}

test('the student list exposes an active recovery after the exam window closed', async () => {
    const [exam] = await new StudentsService(fixture()).listExams(user);
    assert.equal(exam.recoveryUntil, '2026-10-24T05:15:00Z');
    assert.equal(exam.recoverySubmitOnly, true);
    assert.equal(recoveryLabel(exam).button, 'Kirim Jawaban');
    const now = Date.parse(NOW);
    assert.equal(recoveryActive(exam, now), true);
    assert.equal(scheduleState(exam, now), 'open');
    assert.deepEqual(dashboardExams([exam], now).map(item => item.id), ['exam']);
    // Setelah jendela pemulihan habis, ujian kembali tertutup.
    assert.equal(scheduleState(exam, Date.parse('2026-10-24T05:16:00Z')), 'closed');
});

test('an expired recovery is not exposed and the exam stays closed', async () => {
    const [exam] = await new StudentsService(fixture({ recoveryUntil: '2026-10-24T04:30:00Z' })).listExams(user);
    assert.equal(exam.recoveryUntil, undefined);
    assert.equal(scheduleState(exam, Date.parse(NOW)), 'closed');
});

test('the attempt can be opened after the exam window to send the locked copy', async () => {
    const started = await new ExamAttemptsService(fixture(), {}, {}).start(user, 'exam', 'device-one');
    assert.equal(started.started, true, started.error);
    assert.equal(started.attempt.metadata.recovery_submit_only, true);
});

test('submit-only recovery does not require screen sharing; a working session still does', async () => {
    const students = new StudentsService(fixture({ screenshot: true }));
    assert.equal((await students.getExamForAttempt(user, 'exam')).exam.metadata.screenshot_enabled, false);
    const started = await new ExamAttemptsService(fixture({ screenshot: true }), {}, {}).start(user, 'exam', 'device-one', false);
    assert.equal(started.started, true, started.error);

    const working = fixture({ screenshot: true, submitOnly: false });
    assert.equal((await new StudentsService(working).getExamForAttempt(user, 'exam')).exam.metadata.screenshot_enabled, true);
    await assert.rejects(new ExamAttemptsService(working, {}, {}).start(user, 'exam', 'device-one', false), /Bagikan seluruh layar/);
});

test('dashboard and schedule show the recovery deadline and a send button', () => {
    for (const file of ['app/dashboard/siswa/page.tsx', 'app/dashboard/siswa/schedule/page.tsx']) {
        const page = web(file);
        assert.match(page, /recoveryActive\(/, file);
        assert.match(page, /recoveryLabel\(exam\)/, file);
        assert.match(page, /sebelum \$?\{formatSchoolDateTime\(exam\.recoveryUntil, timeZone\)/, file);
    }
});
