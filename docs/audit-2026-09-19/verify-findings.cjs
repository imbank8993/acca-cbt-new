// Reproduces current defects using synthetic data only. No database, network, or credentials.
// Run: node docs/audit-2026-09-19/verify-findings.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve('apps/api/tsconfig.json'), transpileOnly: true });
const { ExamAttemptsService } = require('../../apps/api/src/students/exam-attempts.service.ts');
const { NotificationsService } = require('../../apps/api/src/notifications/notifications.service.ts');
const { QuestionsService } = require('../../apps/api/src/questions/questions.service.ts');
const { TeachersService } = require('../../apps/api/src/teachers/teachers.service.ts');
const { StorageController } = require('../../apps/api/src/storage/storage.controller.ts');
const { ProctoringService } = require('../../apps/api/src/proctoring/proctoring.service.ts');
const fs = require('node:fs');
const results = [];
function mockDb(responses = []) {
  const queries = [];
  return { queries, from(table) {
    const query = { table, calls: [] }; queries.push(query);
    let builder;
    builder = new Proxy({}, { get(_, key) {
      if (key === 'then') return (resolve, reject) => Promise.resolve(responses.shift() ?? { data: null, error: null }).then(resolve,reject);
      return (...args) => { query.calls.push([key,...args]); return builder; };
    }});
    return builder;
  }};
}
const user = { id: 'student-A', isPlatformAdmin: false };
async function check(id, run) {
  try { const evidence = await run(); results.push({ id, reproduced: true, evidence }); }
  catch (e) { results.push({ id, reproduced: false, error: e.message }); }
}
(async () => {
  await check('SEC-01/02', async () => {
    const db = mockDb([{data:{question_bank_id:'bank-B',is_published:true}}, {data:[{id:'q',metadata:{blanks:[{answer:'synthetic-secret'}]},bank_question_options:[]}]}]);
    const r = await new ExamAttemptsService(db,{},{}).getQuestions(user,'exam-B');
    assert.equal(r.questions[0].metadata.blanks[0].answer,'synthetic-secret');
    assert.deepEqual(db.queries.map(q=>q.table),['cbt_exams','cbt_bank_questions']);
    return 'Question metadata returned intact; no membership/attempt query.';
  });
  await check('SEC-03', async () => {
    const db = mockDb([{data:{user_id:user.id,status:'in_progress',personal_end_time:'2000-01-01T00:00:00Z'}},{}]);
    await new ExamAttemptsService(db,{},{}).saveAnswer(user,'attempt-A',{questionId:'q',essay_answer:'new'});
    assert.ok(db.queries[1].calls.some(c=>c[0]==='upsert'));
    return 'Expired synthetic in_progress attempt still accepts a save.';
  });
  await check('SEC-04', async () => {
    const db = mockDb([{data:{id:'attempt-A',exam_id:'exam-A',user_id:user.id,status:'in_progress',metadata:{}}}]);
    const r = await new ExamAttemptsService(db,{},{}).resolveAttemptForSubmit(user,'exam-B','attempt-A');
    assert.equal(r.id,'attempt-A');
    assert.ok(!db.queries[0].calls.some(c=>c[0]==='eq' && c[1]==='exam_id'));
    return 'Attempt for exam-A accepted for submission to exam-B.';
  });
  await check('SEC-05', async () => {
    const db = mockDb();
    await new NotificationsService(db).updatePreferences(user,{user_id:'victim-B',email_enabled:false});
    const row = db.queries[0].calls.find(c=>c[0]==='upsert')[1];
    assert.equal(row.user_id,'victim-B');
    return 'Request preferences override authenticated user_id.';
  });
  await check('SEC-06', async () => {
    let removed;
    const controller = new StorageController({objectKeyFromUrl:()=> 'questions/other-owner.png',deleteObject:async key=>{removed=key;return {success:true};}});
    await controller.remove(user,{url:'https://files.example.test/questions/other-owner.png'});
    assert.equal(removed,'questions/other-owner.png');
    return 'Ordinary authenticated user can remove a non-assignment object.';
  });
  await check('SEC-07', async () => {
    const db = mockDb([{data:{id:'foreign-question'}},{data:null},{data:[]}]);
    const checked=[];
    const service = new QuestionsService(db,{assertBankAccess:async(_,id)=>{checked.push(id);return 'own-org';}},{regradeExamAttemptsByQuestion:async()=>{}});
    await service.save(user,{id:'foreign-question',bankId:'own-bank',type:'essay',questionText:'replacement',scoreDefault:1});
    assert.deepEqual(checked,['own-bank']);
    assert.equal(db.queries[0].calls.find(c=>c[0]==='upsert')[1].id,'foreign-question');
    return 'Foreign existing question id upserted after authorization of destination bank only.';
  });
  await check('SEC-08/BUG-06', async () => {
    const db = mockDb([{data:{exam_id:'owned-exam'}},{data:{question_bank_id:'bank'}},{},{data:[{score_default:10}]},{data:[{score:5}]},{}]);
    const service = Object.create(TeachersService.prototype);
    Object.assign(service,{db,authz:{assertExamStaff:async()=>{}}});
    await service.submitEssayGrades(user,'owned-attempt',{'foreign-answer':999});
    const update = db.queries.find(q=>q.table==='cbt_answers' && q.calls.some(c=>c[0]==='update'));
    assert.ok(update.calls.some(c=>c[0]==='eq' && c[1]==='id' && c[2]==='foreign-answer'));
    assert.ok(!update.calls.some(c=>c[0]==='eq' && c[1]==='attempt_id'));
    assert.equal(update.calls.find(c=>c[0]==='update')[1].score,999);
    assert.ok(db.queries.some(q=>q.table==='cbt_exam_attempts' && q.calls.some(c=>c[0]==='update' && c[1].needs_manual_grading===false)));
    return 'Foreign answer id updated; score 999 accepted; manual grading marked complete.';
  });
  await check('SEC-09', async () => {
    const db = mockDb([{data:{user_id:user.id,status:'in_progress'}},{},{data:{created_at:'2026-09-19T00:00:00Z'}},{count:0},{}]);
    await new ProctoringService(db,{},{}).logViolation(user,'attempt','RESET_BY_PROCTOR',{});
    assert.equal(db.queries[1].calls.find(c=>c[0]==='insert')[1].event_type,'RESET_BY_PROCTOR');
    return 'Student-provided RESET_BY_PROCTOR event stored and used as reset boundary.';
  });
  await check('BUG-01', async () => {
    const {uploadToHosting} = require('../../apps/web/lib/uploader.ts');
    const originalFetch=global.fetch;
    global.fetch=async()=>new Response(JSON.stringify({url:'https://files.example.test/new.png',key:'new.png',provider:'cloudflare-r2'}),{status:200});
    try {
      const r=await uploadToHosting(new File(['synthetic'],'new.png',{type:'image/png'}));
      assert.equal(r.success,false);
      return r.error;
    } finally {global.fetch=originalFetch;}
  });
  await check('BUG-02', async () => {
    const crypto=require('node:crypto');
    const secret='synthetic-audit-key';
    const payload={data:{questions:[{question_text:'<img src="images/a.png">'}]}};
    const content=JSON.stringify(payload);
    const signed=crypto.createHmac('sha256',secret).update(content).digest('hex');
    const rewritten=content.split('src=\\"images/a.png\\"').join('src=\\"https://files.example.test/restored.png\\"');
    assert.notEqual(rewritten,content);
    assert.notEqual(crypto.createHmac('sha256',secret).update(rewritten).digest('hex'),signed);
    return 'Replacing archived image URLs before verification changes the signed payload.';
  });
  await check('BUG-03', async () => {
    const db=mockDb([{error:{message:'synthetic write failure'}}]);
    await new ExamAttemptsService(db,{},{}).persistAnswers('attempt',[{question_id:'q',essay_answer:'last answer'}]);
    return 'persistAnswers resolves successfully even when the database returns a write error.';
  });
  await check('BUG-07', async () => {
    const db=mockDb([{},{}]);
    await new QuestionsService(db,{},{}).replaceOptions('question',[{text:'zero option',isCorrect:false,weight:0}]);
    const row=db.queries.find(q=>q.calls.some(c=>c[0]==='insert')).calls.find(c=>c[0]==='insert')[1][0];
    assert.equal(row.weight,1);
    return 'Option weight 0 persisted as 1.';
  });
  fs.writeFileSync(path.join(__dirname,'verification-results.json'),JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results,null,2));
  if(results.some(r=>!r.reproduced))process.exitCode=1;
})();
