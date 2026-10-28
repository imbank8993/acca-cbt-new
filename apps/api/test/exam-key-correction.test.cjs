const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
require('ts-node').register({project:path.resolve(__dirname,'../tsconfig.json'),transpileOnly:true});
const {fixtureDb}=require('./fixture-db.cjs');
const {ExamKeyCorrectionService}=require('../src/grading/exam-key-correction.service.ts');
const {GradingService}=require('../src/grading/grading.service.ts');
const {ExamAdminService}=require('../src/proctor/exam-admin.service.ts');
const {readExamQuestionVersion,loadFrozenExamQuestions}=require('../src/common/exam-question-snapshots.ts');
const {applyExamQuestionKey,examQuestionKey}=require('@acca-cbt/shared');
const user={id:'staff'};
function fixture(options={}) {
 const q={id:'q',bank_id:'bank',type:'mcq',question_text:'Frozen',bank_question_options:[{id:'a',is_correct:true},{id:'b',is_correct:false}]};
 const db=fixtureDb({cbt_exams:[{id:'exam',show_results:true,end_time:'2026-09-19T00:00:00Z',scoring_type:'classical,irt_1pl',metadata:{unrelated:'retained'}}],
  cbt_exam_question_snapshots:[{exam_id:'exam',question_snapshot:q}],
  cbt_exam_attempts:['one','two'].map(id=>({id,exam_id:'exam',status:'submitted',total_score:90,score_irt:81,detailed_scores:{irt_1pl:81}})),
  cbt_answers:[{attempt_id:'one',question_id:'q',selected_option_id:'b',essay_answer:null}]},options.failedTables||[],options.dbOptions||{});
 const calls=[];
 const grading={gradeAttemptFromSavedAnswers:async id=>{calls.push(id);db.tables.cbt_exam_attempts.find(a=>a.id===id).total_score=95;return{id}},
  applyRelativeQuizScoringIfQuiz:async()=>calls.push('relative'),calculateIrt:async()=>calls.push('irt')};
 const auth={assertBankAccess:async()=>{if(options.denied)throw Error('Denied')},assertExamStaff:async()=>{if(options.denied)throw Error('Denied')}};
 return {db,q,calls,grading,service:new ExamKeyCorrectionService(db,auth,grading)};
}
const change={revision:0,reason:'Kunci seharusnya B',changes:[{questionId:'q',key:'b'}]};
test('correction hides and invalidates old scores, preserves original key and student answers, records audit',async()=>{
 const {db,q,service}=fixture();const answers=structuredClone(db.tables.cbt_answers);
 await service.save(user,'exam',change);
 assert.equal(db.tables.cbt_exams[0].show_results,false);
 assert.equal(db.tables.cbt_exams[0].metadata.unrelated,'retained');
 assert.equal(db.tables.cbt_exams[0].metadata.key_correction_history[0].actorId,'staff');
 assert.deepEqual(db.tables.cbt_exams[0].metadata.key_correction_history[0].changes,[{questionId:'q',before:'a',after:'b'}]);
 assert.equal(db.tables.cbt_exam_attempts[0].total_score,null);
 assert.equal(db.tables.cbt_exam_attempts[0].score_irt,null);
 assert.equal(db.tables.cbt_exam_attempts[0].detailed_scores,null);
 assert.deepEqual(db.tables.cbt_answers,answers);
 assert.deepEqual(db.tables.cbt_exam_question_snapshots[0].question_snapshot,q);
 assert.equal(examQuestionKey((await readExamQuestionVersion(db,'exam'))[0]),'b');
 assert.equal(examQuestionKey((await loadFrozenExamQuestions(db,'exam'))[0]),'b');
 await assert.rejects(service.save(user,'exam',change),/Kunci berubah/);
});
test('resume regrades every participant before recalculating IRT and leaves publication closed',async()=>{
 const {service,db,calls}=fixture();await service.save(user,'exam',change);
 assert.deepEqual(await service.recalculate(user,'exam'),{done:false,completed:1,total:2});
 assert.deepEqual(await service.recalculate(user,'exam'),{done:false,completed:2,total:2});
 assert.deepEqual(await service.recalculate(user,'exam'),{done:true,completed:2,total:2});
 assert.deepEqual(calls,['one','two','relative','irt']);
 await service.recalculate(user,'exam');assert.equal(calls.length,4);
 assert.equal(db.tables.cbt_exams[0].show_results,false);
 assert.equal(db.tables.cbt_exams[0].metadata.key_correction.state,'ready');
});
test('failed regrade is resumable without advancing progress or republishing',async()=>{
 const {service,grading,db}=fixture();await service.save(user,'exam',change);
 grading.gradeAttemptFromSavedAnswers=async()=>{throw Error('scoring unavailable')};
 await assert.rejects(service.recalculate(user,'exam'),/unavailable/);
 const state=db.tables.cbt_exams[0].metadata.key_correction;
 assert.equal(state.completed,0);assert.equal(state.token,null);assert.equal(state.state,'pending');
 assert.equal(db.tables.cbt_exams[0].show_results,false);
 grading.gradeAttemptFromSavedAnswers=async()=>({});
 assert.equal((await service.recalculate(user,'exam')).completed,1);
});
test('concurrent resume requests cannot process the same participant twice',async()=>{
 const f=fixture();await f.service.save(user,'exam',change);
 let release,started;
 const gate=new Promise(resolve=>{release=resolve});
 const begin=new Promise(resolve=>{started=resolve});
 f.grading.gradeAttemptFromSavedAnswers=async()=>{started();await gate;return{}};
 const first=f.service.recalculate(user,'exam');await begin;
 await assert.rejects(f.service.recalculate(user,'exam'),/sedang diproses/);
 release();assert.equal((await first).completed,1);
 assert.equal(f.db.tables.cbt_exams[0].metadata.key_correction.completed,1);
});
test('changed cohort and pending manual grading cannot finish the correction or reopen scores',async()=>{
 for(const mutate of [db=>db.tables.cbt_exam_attempts[0].status='in_progress',db=>db.tables.cbt_exam_attempts[0].needs_manual_grading=true]){
  const f=fixture();await f.service.save(user,'exam',change);
  await f.service.recalculate(user,'exam');await f.service.recalculate(user,'exam');mutate(f.db);
  await assert.rejects(f.service.recalculate(user,'exam'));
  assert.equal(f.db.tables.cbt_exams[0].show_results,false);
  assert.equal(f.db.tables.cbt_exams[0].metadata.key_correction.state,'pending');
 }
});
test('unauthorized, active, unfinished, legacy and foreign-question corrections fail before mutation',async()=>{
 const denied=fixture({denied:true});
 for(const action of [()=>denied.service.get(user,'exam'),()=>denied.service.save(user,'exam',change),()=>denied.service.recalculate(user,'exam')])await assert.rejects(action,/Denied/);
 assert.equal(denied.db.writes.length,0);
 for(const mutate of [f=>f.db.tables.cbt_exam_attempts[0].status='in_progress',f=>f.db.tables.cbt_exams[0].end_time='2026-09-21T00:00:00Z',f=>f.db.tables.cbt_exam_question_snapshots=[]]){
  const f=fixture();mutate(f);await assert.rejects(f.service.save(user,'exam',change));assert.equal(f.db.writes.length,0);
 }
 const foreign=fixture();await assert.rejects(foreign.service.save(user,'exam',{...change,changes:[{questionId:'other',key:'b'}]}));assert.equal(foreign.db.writes.length,0);
});
test('invalidation failure rolls back the entire correction and audit',async()=>{
 const f=fixture({dbOptions:{failMutation:{table:'cbt_exam_attempts',mutation:'update'}}});
 await assert.rejects(f.service.save(user,'exam',change));
 assert.equal(f.db.tables.cbt_exams[0].show_results,true);assert.equal(f.db.tables.cbt_exams[0].metadata.answer_key_overrides,undefined);
});
test('exam editing cannot publish incomplete correction scores',async()=>{
 const f=fixture();await f.service.save(user,'exam',change);
 const service=new ExamAdminService(f.db,{assertExamStaff:async()=>{}},{});
 await assert.rejects(service.update(user,'exam',{showResults:true}),/Selesaikan penilaian ulang/);
 assert.equal(f.db.tables.cbt_exams[0].show_results,false);
});
test('grading and IRT reject results computed against an obsolete correction key',async()=>{
 for(const mode of ['grading','irt']){
  const f=fixture();
  const scoring={post:async()=>{
   f.db.tables.cbt_exams[0].metadata.answer_key_overrides={q:'b'};
   return mode==='grading' ? {items:[],total_score:1,max_possible_score:1,dimension_scores:{}}
    : {score_scale:'theta',count:2,attempts:['one','two'].map(id=>({id,detailed_scores:{irt_1pl:99},score_irt:99})),items:[],warnings:[]};
  }};
  const grading=new GradingService(f.db,{assertExamStaff:async()=>{}},scoring);
  await assert.rejects(mode==='grading'?grading.gradeAttemptFromSavedAnswers('one',false):grading.calculateIrt(user,'exam'),/Kunci ujian berubah/);
  assert.equal(f.db.tables.cbt_exam_attempts[0].total_score,90);
  assert.equal(f.db.tables.cbt_exam_attempts[0].score_irt,81);
 }
});
test('key validation covers objective question types without replacing options, text or score weights',()=>{
 const base={id:'q',type:'mcq_complex',question_text:'same',score_default:2,metadata:{categories:['C1','C2'],right_items:['R1','R2']},
  bank_question_options:[{id:'a',option_text:'A',is_correct:true},{id:'b',option_text:'B',is_correct:false}]};
 const complex=applyExamQuestionKey(base,'["a","b"]');assert.deepEqual(complex.bank_question_options.map(o=>o.is_correct),[true,true]);
 assert.equal(complex.question_text,'same');assert.equal(complex.score_default,2);assert.deepEqual(complex.bank_question_options.map(o=>o.id),['a','b']);
 assert.deepEqual(applyExamQuestionKey({...base,type:'true_false'},'{"a":false,"b":true}').bank_question_options.map(o=>o.is_correct),[false,true]);
 assert.equal(applyExamQuestionKey({...base,type:'matching'},'{"a":["R2"],"b":["R1"]}').bank_question_options[0].metadata.match_text,'R2');
 assert.equal(applyExamQuestionKey({...base,type:'categorization'},'{"a":["C2"],"b":["C1"]}').bank_question_options[0].metadata.category_name,'C2');
 assert.deepEqual(applyExamQuestionKey({...base,type:'ordering'},'["b","a"]').metadata.correct_order,['b','a']);
 assert.equal(applyExamQuestionKey({...base,type:'short_answer',metadata:{blanks:[{answer:'old',variations:['stale']}] }},'["new"]').metadata.blanks[0].variations.length,0);
 for(const [type,key] of [['mcq','other'],['mcq_complex','["a","a"]'],['true_false','{"a":true}'],['ordering','["a"]'],['matching','{"a":["foreign"],"b":["R1"]}'],['essay','a']])assert.throws(()=>applyExamQuestionKey({...base,type},key));
});
