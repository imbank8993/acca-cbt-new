const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { StudentsService } = require('../src/students/students.service.ts');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const user = { id: 'student' };

function fixture(attempts = []) {
    return fixtureDb({
        cbt_exams: [{ id: 'exam', organization_id: 'school', is_published: true,
            duration_minutes: 60, start_time: '2026-09-19T23:00:00Z', end_time: '2026-09-20T02:00:00Z',
            metadata: { is_public: true } }],
        cbt_organization_members: [{ user_id: user.id, organization_id: 'school', is_active: true }],
        cbt_profiles: [{ id: user.id, full_name: 'Siswa Uji' }],
        cbt_exam_attempts: attempts,
    });
}

test('opening preparation repeatedly creates no attempt; explicit start records database time', async () => {
    const db = fixture();
    const students = new StudentsService(db);
    for (let i = 0; i < 3; i++) {
        assert.equal((await students.getExamForAttempt(user, 'exam')).hasStartedAttempt, false);
    }
    assert.equal(db.writes.length, 0);
    const attempts = new ExamAttemptsService(db, {}, {});
    const started = await attempts.start(user, 'exam', 'device-test');
    assert.equal(started.started, true);
    assert.equal(started.attempt.started_at, '2026-09-20T00:00:00.000Z');
    assert.equal(started.attempt.personal_end_time, '2026-09-20T01:00:00.000Z');
    assert.equal((await students.getExamForAttempt(user, 'exam')).hasStartedAttempt, true);
});

for (const status of ['in_progress', 'submitted', 'auto_submitted']) {
    test(`preparation detects owned ${status} attempt without modifying its time`, async () => {
        const attempt = { id: 'attempt', user_id: user.id, exam_id: 'exam', status,
            started_at: '2026-09-19T23:40:00Z', personal_end_time: '2026-09-20T00:40:00Z' };
        const db = fixture([attempt]);
        assert.equal((await new StudentsService(db).getExamForAttempt(user, 'exam')).hasStartedAttempt, true);
        assert.deepEqual(db.tables.cbt_exam_attempts[0], attempt);
        assert.equal(db.writes.length, 0);
    });
}

test('another student or another exam cannot bypass preparation', async () => {
    const db = fixture([
        { id: 'other-user', user_id: 'other', exam_id: 'exam', status: 'in_progress' },
        { id: 'other-exam', user_id: user.id, exam_id: 'other-exam', status: 'in_progress' },
    ]);
    assert.equal((await new StudentsService(db).getExamForAttempt(user, 'exam')).hasStartedAttempt, false);
});

test('status read failure refuses preparation instead of assuming a fresh attempt', async () => {
    const db = fixture();
    const failed = fixtureDb(db.tables, ['cbt_exam_attempts']);
    await assert.rejects(new StudentsService(failed).getExamForAttempt(user, 'exam'), /Status pengerjaan/);
});
