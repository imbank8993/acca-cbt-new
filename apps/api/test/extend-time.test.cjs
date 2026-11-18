const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');
const { examDeadline } = require('../src/common/exam-deadline.ts');
const { NON_WARNING_EVENTS } = require('../src/common/student-security-events.ts');
const grading = { gradeAttemptFromSavedAnswers: async () => null };
const NOW = '2026-10-24T01:00:00Z';

function fixture(attempt = {}, staff = async () => {}) {
    const exam = { id: 'exam', organization_id: 'school', end_time: '2026-10-24T02:00:00Z', duration_minutes: 120, metadata: {} };
    const row = { id: 'a1', exam_id: 'exam', user_id: 'student', status: 'in_progress', started_at: '2026-10-24T00:00:00Z',
        personal_end_time: '2026-10-24T01:20:00Z', warning_count: 2, tab_switch_count: 1, metadata: {}, ...attempt };
    const db = fixtureDb({ cbt_exams: [exam], cbt_exam_attempts: [row], cbt_attempt_security_logs: [], cbt_answers: [] }, [], { now: NOW });
    return { db, row, proctor: new ProctoringService(db, { assertExamStaff: staff }, grading) };
}

test('extend adds minutes to the current deadline and keeps answers, status and violation counts', async () => {
    const { db, proctor } = fixture();
    const result = await proctor.extendAttemptTime({ id: 'proctor' }, 'a1', 10, 'Listrik padam di ruang 3');
    const row = db.tables.cbt_exam_attempts[0];
    assert.equal(result.deadline, '2026-10-24T01:30:00.000Z', '01:20 + 10 menit, bukan "minimal 10 menit dari sekarang"');
    assert.equal(row.status, 'in_progress');
    assert.equal(row.warning_count, 2);
    assert.equal(row.tab_switch_count, 1);
    assert.equal(examDeadline(row, db.tables.cbt_exams[0]).toISOString(), '2026-10-24T01:30:00.000Z');
    assert.deepEqual(row.metadata.superseded_deadlines, ['2026-10-24T01:20:00Z']);
    const log = db.tables.cbt_attempt_security_logs.find(entry => entry.event_type === 'TIME_EXTENDED_BY_PROCTOR');
    assert.equal(log.metadata.added_minutes, 10);
    assert.equal(log.metadata.reason, 'Listrik padam di ruang 3');
    assert.ok(NON_WARNING_EVENTS.includes('TIME_EXTENDED_BY_PROCTOR'), 'tambah waktu bukan pelanggaran');
});

test('extension can go past the exam window, and an already-expired deadline counts from now', async () => {
    const late = fixture({ personal_end_time: '2026-10-24T01:58:00Z' });
    assert.equal((await late.proctor.extendAttemptTime({ id: 'p' }, 'a1', 15, 'Gangguan jaringan')).deadline, '2026-10-24T02:13:00.000Z');
    assert.equal(examDeadline(late.db.tables.cbt_exam_attempts[0], late.db.tables.cbt_exams[0]).toISOString(), '2026-10-24T02:13:00.000Z');
    const expired = fixture({ personal_end_time: '2026-10-24T00:50:00Z' });
    assert.equal((await expired.proctor.extendAttemptTime({ id: 'p' }, 'a1', 5, 'Gangguan jaringan')).deadline, '2026-10-24T01:05:00.000Z');
});

test('extension is refused for closed, submit-only, unauthorized or invalid requests', async () => {
    const rejects = async (setup, call) => assert.rejects(call(setup.proctor));
    await rejects(fixture({ status: 'submitted' }), p => p.extendAttemptTime({ id: 'p' }, 'a1', 10, 'Gangguan jaringan'));
    await rejects(fixture({ metadata: { recovery_submit_only: true } }), p => p.extendAttemptTime({ id: 'p' }, 'a1', 10, 'Gangguan jaringan'));
    await rejects(fixture({}, async () => { throw new Error('forbidden'); }), p => p.extendAttemptTime({ id: 'p' }, 'a1', 10, 'Gangguan jaringan'));
    await rejects(fixture(), p => p.extendAttemptTime({ id: 'p' }, 'a1', 0, 'Gangguan jaringan'));
    await rejects(fixture(), p => p.extendAttemptTime({ id: 'p' }, 'a1', 10, 'abc'));
});

test('monitoring offers bulk time extension only for students still working', () => {
    const web = file => fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');
    const panel = web('app/components/monitoring/BulkExtendTimePanel.tsx');
    assert.match(panel, /attempt\.status === 'in_progress' &&\s*attempt\.metadata\?\.recovery_submit_only !== true/);
    assert.match(panel, /extendExamAttemptTime\(attempt\.id, minutes, reason\.trim\(\)\)/);
    const workspace = web('app/components/monitoring/ParticipantsWorkspace.tsx');
    assert.match(workspace, /\['extend', 'Tambah waktu'\]/);
    assert.match(workspace, /monitoring-actions-badge/);
    assert.match(workspace, /Pulihkan sekarang/);
});
