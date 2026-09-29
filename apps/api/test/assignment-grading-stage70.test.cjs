const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ExamMonitoringService } = require('../src/proctor/exam-monitoring.service.ts');

const user = { id: 'staff', role: 'Admin' };

function service({ examType = 'assignment', status = 'submitted' } = {}) {
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', exam_type: examType }],
        cbt_exam_attempts: [{ id: 'attempt', exam_id: 'exam', status, metadata: { retained: true } }],
    });
    const result = Object.create(ExamMonitoringService.prototype);
    Object.assign(result, { db, authz: { assertExamStaff: async () => {} } });
    return { db, result };
}

for (const score of [-1, 101, Number.NaN, '80']) {
    test(`assignment rejects invalid service-level score ${String(score)}`, async () => {
        const { db, result } = service();
        await assert.rejects(result.gradeAssignment(user, 'attempt', score, ''), /0 dan 100/);
        assert.equal(db.writes.length, 0);
    });
}

test('assignment grading rejects ordinary exam and unfinished attempt', async () => {
    await assert.rejects(service({ examType: 'exam' }).result.gradeAssignment(user, 'attempt', 80, ''), /bukan tugas/);
    await assert.rejects(service({ status: 'in_progress' }).result.gradeAssignment(user, 'attempt', 80, ''), /belum dikumpulkan/);
});

test('assignment grading stores a valid score and preserves metadata', async () => {
    const { db, result } = service();
    assert.deepEqual(await result.gradeAssignment(user, 'attempt', 80, 'Baik'), { attemptId: 'attempt', score: 80 });
    const attempt = db.tables.cbt_exam_attempts[0];
    assert.equal(attempt.total_score, 80);
    assert.equal(attempt.metadata.retained, true);
    assert.equal(attempt.metadata.teacher_feedback, 'Baik');
});
