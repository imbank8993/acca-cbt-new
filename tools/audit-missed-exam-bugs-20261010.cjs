// Regression checks for the follow-up exam audit.
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../apps/api/tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('../apps/api/test/fixture-db.cjs');
const { GradingService } = require('../apps/api/src/grading/grading.service.ts');
const { ExamMonitoringService } = require('../apps/api/src/proctor/exam-monitoring.service.ts');
const staff = { assertExamStaff: async () => {} };
function fixture(options = {}) {
  return fixtureDb({
    cbt_exams: [{ id: 'exam', exam_type: 'assignment', scoring_type: 'irt' }],
    cbt_exam_attempts: [{ id: 'a', exam_id: 'exam', user_id: 's', status: 'submitted', metadata: {}, score_irt: null, answers: [] }],
    cbt_exam_question_snapshots: [{ id: 'snap', exam_id: 'exam', question_id: 'q', order_number: 1,
      question_snapshot: { id: 'q', type: 'mcq', score_default: 1, bank_question_options: [] } }],
  }, [], options);
}
const result = { count: 1, attempts: [{ id: 'a', score_irt: 750, detailed_scores: { irt: 750 } }], items: [], warnings: [] };
(async () => {
  const reset = fixture();
  await assert.rejects(new GradingService(reset, staff, { post: async () => {
    reset.tables.cbt_exam_attempts[0] = { ...reset.tables.cbt_exam_attempts[0], status: 'in_progress', score_irt: null };
    return result;
  } }).calculateIrt({ id: 'teacher' }, 'exam'), /berubah/);
  assert.equal(reset.tables.cbt_exam_attempts[0].status, 'in_progress');
  assert.equal(reset.tables.cbt_exam_attempts[0].score_irt, null);
  console.log('PASS: stale IRT rejected after reset');

  const failure = fixture({ failMutation: { table: 'cbt_exam_attempts', mutation: 'update' } });
  await assert.rejects(new GradingService(failure, staff, { post: async () => result }).calculateIrt({ id: 'teacher' }, 'exam'), /gagal disimpan/);
  assert.equal(failure.tables.cbt_exam_attempts[0].score_irt, null);
  console.log('PASS: failed IRT persistence is reported');

  const assignment = fixture();
  const service = Object.create(ExamMonitoringService.prototype);
  service.db = assignment;
  service.authz = { assertExamStaff: async () => {
    assignment.tables.cbt_exam_attempts[0] = { ...assignment.tables.cbt_exam_attempts[0],
      finished_at: '2026-10-10T02:00:00Z', metadata: { new_submission: true }, total_score: null };
  } };
  await assert.rejects(service.gradeAssignment({ id: 'teacher' }, 'a', 90, 'old submission feedback'), /berubah/);
  assert.equal(assignment.tables.cbt_exam_attempts[0].total_score, null);
  assert.equal(assignment.tables.cbt_exam_attempts[0].metadata.new_submission, true);
  console.log('PASS: old assignment grading rejected without losing new metadata');
  const success = fixture();
  await new GradingService(success, staff, { post: async () => result }).calculateIrt({ id: 'teacher' }, 'exam');
  assert.equal(success.tables.cbt_exam_attempts[0].score_irt, 750);
  console.log('PASS: unchanged IRT persists successfully');
})().catch(error => { console.error(error); process.exitCode = 1; });
