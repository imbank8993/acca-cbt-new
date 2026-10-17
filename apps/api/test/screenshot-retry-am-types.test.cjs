const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { sendScreenshotWithRetry } = require('../../web/lib/exam-screenshots.ts');
const { examTypeCategory, examTypeLabel, matchesExamType, isFolderExamCategory } = require('../../web/lib/exam-types.ts');
const { isSemesterAssessmentExam } = require('../src/common/exam-types.ts');

test('screenshot retries transient failures and stops after success', async () => {
 let calls = 0; const delays = [];
 const result = await sendScreenshotWithRetry(async () => {
  calls++;
  if (calls === 1) throw new Error('network');
  return calls === 2 ? { success: false, retryable: true } : { success: true, saved: true };
 }, async ms => { delays.push(ms); });
 assert.equal(result.saved, true);
 assert.equal(calls, 3);
 assert.deepEqual(delays, [1000, 2000]);
});

test('screenshot does not retry permission failures or loop forever', async () => {
 let calls = 0;
 await sendScreenshotWithRetry(async () => { calls++; return { success: false, retryable: false }; }, async () => {});
 assert.equal(calls, 1);
 calls = 0;
 await assert.rejects(sendScreenshotWithRetry(async () => { calls++; throw new Error('offline'); }, async () => {}));
 assert.equal(calls, 3);
});

test('AM has its own category and folder filters do not confuse ASAS/ASAT with other exams', () => {
 assert.equal(examTypeCategory('am'), 'am');
 assert.equal(examTypeLabel('am'), 'Asesmen Madrasah');
 assert.equal(matchesExamType('am', 'am'), true);
 assert.equal(matchesExamType('pas', 'asas_asat'), true);
 assert.equal(matchesExamType('pat', 'asas_asat'), true);
 assert.equal(matchesExamType('am', 'asas_asat'), false);
 assert.equal(matchesExamType('lainnya', 'asas_asat'), false);
});

test('AM and ASAS/ASAT share the folder workflow and the same backend assessment policy', () => {
 for (const type of ['pas', 'pat', 'am']) {
  assert.equal(isSemesterAssessmentExam({ exam_type: type }), true);
  assert.equal(isFolderExamCategory(examTypeCategory(type)), true);
 }
 for (const type of ['daily', 'tryout', 'assignment', 'lainnya', undefined, null]) {
  assert.equal(isSemesterAssessmentExam({ exam_type: type }), false);
  assert.equal(isFolderExamCategory(type), false);
 }
});
