const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { AuthorizationService } = require('../src/auth/authorization.service.ts');
const { ExamAdminService } = require('../src/proctor/exam-admin.service.ts');
const { ExamMonitoringService } = require('../src/proctor/exam-monitoring.service.ts');
const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');
const { GradingService } = require('../src/grading/grading.service.ts');
const { TeachersService } = require('../src/teachers/teachers.service.ts');

for (const examType of ['quiz', 'pas', 'pat']) {
 test(`bank owner has read/export access but cannot mutate ${examType} owned by proctor`, async () => {
  const exam = { id: 'exam', created_by: 'proctor', organization_id: 'school', question_bank_id: 'bank', exam_type: examType };
  const db = fixtureDb({
   cbt_exams: [exam], cbt_question_banks: [{ id: 'bank', created_by: 'teacher', organization_id: 'school' }],
   cbt_exam_attempts: [{ id: 'attempt', exam_id: 'exam', user_id: 'student', status: 'submitted', exams: exam }],
  });
  const roles = { hasOrgRole: async (id, org, allowed) => org === 'school' && allowed.includes(id === 'proctor' ? 'Proktor' : 'Guru') };
  const scope = { assertSchoolId: async id => { assert.equal(id, 'school'); return id; } };
  const auth = new AuthorizationService(db, roles, scope);
  const user = { id: 'teacher' };
  await auth.assertExamMonitoring(user, 'exam');
  assert.equal(await auth.canManageExam(user, exam), false);
  const rows = await new ExamAdminService(db, auth, roles).list(user, 'school');
  assert.equal(rows[0].canManage, false);
  const details = await new ExamMonitoringService(db, auth, {}, {}, { findById: async () => null }).getAttemptDetails(user, 'attempt');
  assert.equal(details.canManage, false);
  const service = new ProctoringService(db, auth, {});
  const forbidden = error => error.getStatus?.() === 403;
  await assert.rejects(service.resetAttempt(user, 'attempt', 'Alasan pemulihan', 30), forbidden);
  await assert.rejects(service.startMakeupAttempt(user, 'attempt', 'Alasan susulan', 30), forbidden);
  await assert.rejects(new GradingService(db, auth, {}).calculateIrt(user, 'exam'), forbidden);
  await assert.rejects(new TeachersService(db, auth, {}).submitEssayGrades(user, 'attempt', { answer: 100 }), forbidden);
  await auth.assertExamStaff({ id: 'proctor' }, 'exam');
  exam.created_by = user.id;
  assert.equal(await auth.canManageExam(user, exam), examType === 'quiz');
 });
}
