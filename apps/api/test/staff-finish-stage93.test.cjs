const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ExamMonitoringService } = require('../src/proctor/exam-monitoring.service.ts');
const { ExamAdminService } = require('../src/proctor/exam-admin.service.ts');
const { PasSchedulesService } = require('../src/pas/pas-schedules.service.ts');

const EXAM = '33333333-3333-4333-8333-333333333333';
const ATTEMPT = '55555555-5555-4555-8555-555555555555';

function monitoring({ canManage = true, metadata = {}, status = 'in_progress' } = {}) {
    const db = fixtureDb({
        cbt_exams: [{ id: EXAM, organization_id: 'org', created_by: 'teacher', exam_type: 'daily', is_published: true }],
        cbt_exam_attempts: [{ id: ATTEMPT, exam_id: EXAM, user_id: 'siswa', status, metadata }],
        cbt_attempt_security_logs: [],
    }, [], { now: '2026-10-22T08:00:00Z' });
    const graded = [];
    const s = Object.create(ExamMonitoringService.prototype);
    Object.assign(s, {
        db, logger: { error() {} },
        authz: { canManageExam: async (user, exam) => canManage && exam.id === EXAM },
        grading: { gradeAttemptFromSavedAnswers: async id => { graded.push(id); return { examId: EXAM }; }, applyRelativeQuizScoringIfQuiz: async () => {} },
    });
    return { s, db, graded };
}

test('exam manager finishes a working student: closed, logged with reason, graded', async () => {
    const { s, db, graded } = monitoring();
    const result = await s.finishAttempt({ id: 'teacher' }, ATTEMPT, '  Siswa meminta selesai  ');
    const attempt = db.tables.cbt_exam_attempts[0];
    assert.equal(attempt.status, 'auto_submitted');
    assert.equal(attempt.total_score, null);
    assert.equal(attempt.metadata.closed_by_staff.reason, 'Siswa meminta selesai');
    assert.equal(attempt.metadata.closed_by_expiry, undefined, 'no late local-copy submission after staff closure');
    assert.equal(db.tables.cbt_attempt_security_logs[0].event_type, 'FORCE_TERMINATED');
    assert.equal(db.tables.cbt_attempt_security_logs[0].metadata.actor_user_id, 'teacher');
    assert.deepEqual(graded, [ATTEMPT]);
    assert.equal(result.graded, true);
});

test('someone who cannot manage the exam (e.g. room invigilator) is refused', async () => {
    const { s, db } = monitoring({ canManage: false });
    await assert.rejects(s.finishAttempt({ id: 'pengawas' }, ATTEMPT, 'alasan'), /Hanya pengelola ujian/);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
});

test('finishing requires a reason and a still-running attempt', async () => {
    await assert.rejects(monitoring().s.finishAttempt({ id: 'teacher' }, ATTEMPT, '   '), /alasan/);
    await assert.rejects(monitoring({ status: 'submitted' }).s.finishAttempt({ id: 'teacher' }, ATTEMPT, 'x'), /sudah selesai/);
});

test('a student who is in the middle of submitting is not cut off', async () => {
    const { s, db } = monitoring({ metadata: { submit_intent_at: '2026-10-22T07:59:30Z' } });
    await assert.rejects(s.finishAttempt({ id: 'teacher' }, ATTEMPT, 'x'), /sedang mengumpulkan/);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
});

test('unpublishing is refused while students are working, allowed once they finish', async () => {
    const db = fixtureDb({
        cbt_exams: [{ id: EXAM, is_published: true, status: 'active', metadata: {} }],
        cbt_exam_attempts: [{ id: ATTEMPT, exam_id: EXAM, status: 'in_progress' }],
    });
    const s = Object.create(ExamAdminService.prototype);
    Object.assign(s, { db, authz: { assertExamStaff: async () => {} } });
    await assert.rejects(s.setPublished({ id: 'staff' }, EXAM, false), /1 siswa sedang mengerjakan.*menarik ujian/);
    assert.equal(db.tables.cbt_exams[0].is_published, true);
    db.tables.cbt_exam_attempts[0].status = 'submitted';
    await s.setPublished({ id: 'staff' }, EXAM, false);
    assert.equal(db.tables.cbt_exams[0].is_published, false);
});

test('deactivating an ASAS/ASAT schedule is refused while students are working', async () => {
    const db = fixtureDb({
        cbt_pas_periods: [{ id: 'p' }],
        cbt_pas_class_schedules: [{ id: 'sc', pas_period_id: 'p', exam_id: EXAM, class_id: 'c' }],
        cbt_exams: [{ id: EXAM, is_published: true }],
        cbt_exam_targets: [{ exam_id: EXAM, class_id: 'c' }],
        cbt_class_members: [{ class_id: 'c', user_id: 'student' }],
        cbt_exam_attempts: [{ id: ATTEMPT, exam_id: EXAM, user_id: 'student', status: 'in_progress' }],
    });
    const s = new PasSchedulesService(db, { assertProktorByParent: async () => {} }, { getSchoolTimeZone: async () => 'Asia/Makassar' });
    await assert.rejects(s.setActivation({ id: 'admin' }, 'sc', false), /menonaktifkan jadwal/);
    assert.equal(db.tables.cbt_exams[0].is_published, true);
    assert.equal(db.tables.cbt_exam_targets.length, 1);
});
