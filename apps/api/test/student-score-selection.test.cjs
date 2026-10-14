const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
require('ts-node').register({project:path.resolve(__dirname,'../tsconfig.json'),transpileOnly:true});
const {studentScoreType,selectedStudentScore,publicStudentScores}=require('@acca-cbt/shared');
const {StudentsService}=require('../src/students/students.service.ts');
const {ExamAdminService}=require('../src/proctor/exam-admin.service.ts');
const {fixtureDb}=require('./fixture-db.cjs');
const {dashboardResultScore,dashboardAverageScore}=require('../../web/lib/student-dashboard-score.ts');
const exam={id:'exam',show_results:true,scoring_type:'classical,irt_1pl',metadata:{student_score_type:'irt_1pl',show_answer_keys:false}};
const attempt={id:'a',user_id:'student',status:'submitted',total_score:90,score_irt:81.33,needs_manual_grading:false,exams:exam};

test('dashboard includes published IRT in history and averages while excluding hidden and pending scores',()=>{
 const irt={...attempt,...publicStudentScores(attempt,exam)};
 assert.equal(irt.total_score,null);
 assert.equal(dashboardResultScore(irt),81.33);
 const zero={...irt,display_score:0};
 const hidden={...irt,exams:{...exam,show_results:false}};
 const pending={...irt,display_score:null,total_score:90};
 assert.equal(dashboardAverageScore([irt,zero,hidden,pending]),41);
 assert.equal(dashboardResultScore(pending),null);
 assert.equal(dashboardResultScore({...irt,needs_manual_grading:true}),null);
 assert.equal(dashboardResultScore({...irt,status:'in_progress'}),null);
 assert.equal(dashboardAverageScore([hidden,pending]),null);
 assert.equal(dashboardResultScore({...attempt,total_score:null}),81.33);
 assert.equal(dashboardResultScore({...irt,display_score:NaN}),null);
});
test('public results expose only the selected score and never substitute classical for pending IRT',()=>{
 assert.deepEqual(publicStudentScores(attempt,exam),{display_score:81.33,score_type:'irt_1pl',score_label:'IRT 1PL',total_score:null,score_irt:81.33});
 assert.equal(publicStudentScores({...attempt,score_irt:null},exam).display_score,null);
 const classical={...exam,metadata:{student_score_type:'classical'}};
 assert.equal(publicStudentScores(attempt,classical).total_score,90);
 assert.equal(publicStudentScores(attempt,classical).score_irt,null);
 assert.equal(publicStudentScores(attempt,{...exam,show_results:false}).display_score,null);
 assert.equal(publicStudentScores({...attempt,status:'in_progress'},exam).display_score,null);
});
test('model choice uses detailed model scores and cannot reuse another model aggregate',()=>{
 const multi={...exam,scoring_type:'irt_1pl,irt_3pl'};
 assert.equal(selectedStudentScore({...attempt,score_irt:99},multi),null);
 assert.equal(selectedStudentScore({...attempt,score_irt:99,detailed_scores:{irt_1pl:71}},multi),71);
 assert.equal(studentScoreType({...multi,metadata:{}}),'irt_3pl');
 assert.equal(selectedStudentScore({...attempt,needs_manual_grading:true},exam),null);
 for(const score of [NaN,Infinity,'',true,101,-1])assert.equal(selectedStudentScore({...attempt,score_irt:score},exam),null);
 assert.equal(selectedStudentScore({...attempt,score_irt:0},exam),0);
});
test('student list and detail are consistent, strip unselected scores and protect ownership',async()=>{
 const db=fixtureDb({cbt_exam_attempts:[{...attempt,detailed_scores:{classical:90,irt_1pl:81.33}}]});
 const service=new StudentsService(db);
 const [listed]=await service.listResults({id:'student'});
 const detail=await service.getAttemptDetails({id:'student'},'a');
 assert.equal(listed.display_score,detail.attempt.display_score);
 assert.equal(listed.total_score,null);assert.equal(detail.attempt.total_score,null);
 assert.equal(listed.detailed_scores,undefined);assert.equal(listed.exams.metadata,undefined);
 assert.equal(detail.answerKeysReleased,false);
 await assert.rejects(service.getAttemptDetails({id:'other'},'a'));
 db.tables.cbt_exam_attempts[0].exams.show_results=false;
 const [hidden]=await service.listResults({id:'student'});
 assert.equal(hidden.display_score,null);assert.equal(hidden.score_irt,null);
 await assert.rejects(service.getAttemptDetails({id:'student'},'a'));
 db.tables.cbt_exam_attempts[0].exams.show_results=true;
});
test('exam configuration validates student score policy and preserves unrelated settings',()=>{
 const service=new ExamAdminService({}, {}, {}, {}, {});
 assert.throws(()=>service.buildMetadata('daily',{scoringType:'classical',studentScoreType:'irt_1pl'},{}),/Jenis nilai siswa/);
 const metadata=service.buildMetadata('daily',{scoringType:'classical,irt_1pl',studentScoreType:'irt_1pl'},{retained:true});
 assert.equal(metadata.student_score_type,'irt_1pl');assert.equal(metadata.retained,true);
});
