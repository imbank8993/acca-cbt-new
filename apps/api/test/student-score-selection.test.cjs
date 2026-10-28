const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
require('ts-node').register({project:path.resolve(__dirname,'../tsconfig.json'),transpileOnly:true});
const {studentScoreType,selectedStudentScore,publicStudentScores}=require('@acca-cbt/shared');
const {StudentsService}=require('../src/students/students.service.ts');
const {ExamAdminService}=require('../src/proctor/exam-admin.service.ts');
const {fixtureDb}=require('./fixture-db.cjs');
const {dashboardResultScore,dashboardAverageScore}=require('../../web/lib/student-dashboard-score.ts');
const {monitoringScoreModels}=require('../../web/lib/monitoring-score-models.ts');
const exam={id:'exam',show_results:true,scoring_type:'classical,irt_1pl',metadata:{student_score_type:'irt_1pl',show_answer_keys:false}};
const attempt={id:'a',user_id:'student',status:'submitted',total_score:90,score_irt:81.33,metadata:{irt_score_scale:'theta'},needs_manual_grading:false,exams:exam};

test('staff analytics shows all configured score models independently of publication and without cross-model fallback',()=>{
 const staffAttempt={...attempt,exams:{...exam,show_results:false,scoring_type:'classical,irt_1pl,irt_2pl,irt_3pl'},
  score_irt:88,detailed_scores:{irt_1pl:71.69,irt_2pl:0}};
 assert.deepEqual(monitoringScoreModels(staffAttempt).map(row=>[row.label,row.score]),
  [['Klasikal',90],['IRT 1PL',71.69],['IRT 2PL',0],['IRT 3PL',88]]);
 assert.equal(monitoringScoreModels({...attempt,score_irt:null})[1].score,null);
 assert.equal(monitoringScoreModels({...attempt,status:'in_progress'})[1].score,null);
 assert.equal(monitoringScoreModels({...attempt,needs_manual_grading:true})[0].score,null);
 assert.deepEqual(monitoringScoreModels({...attempt,exams:{scoring_type:'classical'}}).map(row=>row.label),['Klasikal']);
});

test('released review includes unanswered frozen questions and ignores answers outside the exam',async()=>{
 const released={...exam,end_time:'2026-09-19T00:00:00Z',metadata:{show_answer_keys:true}};
 const question=id=>({id,type:'mcq',question_text:id,score_default:1,bank_question_options:[{id:`${id}-key`,is_correct:true}]});
 const db=fixtureDb({cbt_exam_attempts:[{...attempt,exams:released}],
  cbt_exam_question_snapshots:['q1','q2','q3'].map(id=>({exam_id:'exam',question_snapshot:question(id)})),
  cbt_answers:[{id:'saved',attempt_id:'a',question_id:'q1',selected_option_id:'q1-key',is_correct:true,score:1},
   {id:'foreign',attempt_id:'a',question_id:'other',score:1}]});
 const result=await new StudentsService(db).getAttemptDetails({id:'student'},'a');
 assert.deepEqual(result.answers.map(a=>a.questionId),['q1','q2','q3']);
 assert.equal(result.answers[0].selectedOptionId,'q1-key');
 assert.equal(result.answers[1].selectedOptionId,null);
 assert.equal(result.answers[1].score,0);
 assert.equal(result.answers[1].question.options[0].id,'q2-key');
 assert.equal(db.writes.length,0);
});

test('dashboard includes published IRT in history and averages while excluding hidden and pending scores',()=>{
 const irt={...attempt,...publicStudentScores(attempt,exam)};
 assert.equal(irt.total_score,null);
 assert.equal(dashboardResultScore(irt),81.33);
 const zero={...irt,display_score:0};
 const hidden={...irt,exams:{...exam,show_results:false}};
 const pending={...irt,display_score:null,total_score:90};
 assert.equal(dashboardAverageScore([irt,zero,hidden,pending]),40.665);
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
 for(const score of [NaN,Infinity,'',true])assert.equal(selectedStudentScore({...attempt,score_irt:score},exam),null);
 for(const score of [-1,101])assert.equal(selectedStudentScore({...attempt,score_irt:score},exam),score);
 assert.equal(selectedStudentScore({...attempt,metadata:{}},exam),null, 'Legacy scores require recalculation');
 assert.equal(selectedStudentScore({...attempt,score_irt:0},exam),0);
});
test('signed theta remains visible in public results and separate from classical averages',()=>{
 const negative={...attempt,score_irt:-1.75,detailed_scores:{irt_1pl:-1.75}};
 const published={...negative,...publicStudentScores(negative,exam)};
 assert.equal(published.display_score,-1.75);
 assert.equal(dashboardResultScore(published),-1.75);
 const classical={...attempt,score_type:'classical',display_score:90,exams:{...exam,scoring_type:'classical'}};
 assert.equal(dashboardAverageScore([published,classical]),-1.75);
 assert.equal(dashboardAverageScore([classical,published]),90);
 assert.equal(publicStudentScores({...negative,metadata:{}},exam).display_score,null);
 assert.equal(publicStudentScores({...negative,total_score:-1},{...exam,metadata:{student_score_type:'classical'}}).display_score,null);
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

test('monitoring results expose calculated IRT scores in their own column', () => {
 const fs=require('node:fs');
 const ts=require('typescript');
 const React=require('react');
 const {renderToStaticMarkup}=require('react-dom/server');
 const source=fs.readFileSync(path.resolve(__dirname,'../../web/app/components/monitoring/MonitoringResultsTable.tsx'),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const loaded={exports:{}};
 const dependencies={
  react:{...React,useState:()=>[null,()=>{}]},
  '@/app/components/ui/modal':{Modal:({open,children})=>open?React.createElement('div',null,children):null,ModalHeader:()=>null,ModalBody:({children})=>React.createElement('div',null,children),ModalFooter:({children})=>React.createElement('div',null,children)},
  '@/app/components/ui/button':{Button:({children})=>React.createElement('button',null,children)},
  '@/lib/monitoring-health':{formatStudentName:name=>name||'Peserta',getScoreColorClass:()=>''},
  '@/lib/monitoring-score-models':{monitoringScoreModels},
  '@/lib/monitoring-answer-count':{savedAnswerCount:()=>1},
  './ParticipantRoomInfo':{ParticipantRoomInfo:()=>null},
 };
 new Function('require','module','exports',code)(name=>dependencies[name]||require(name),loaded,loaded.exports);
 const render=overrides=>renderToStaticMarkup(React.createElement(loaded.exports.MonitoringResultsTable,{
  attempts:[{...attempt,profiles:{full_name:'Peserta'},...overrides}],hasAnyAttempts:true,onViewDetails:()=>{},
 }));
 const irtCell=html=>{const cells=html.match(/<td\b[^>]*>[\s\S]*?<\/td>/g);return cells[4];};
 assert.match(render({}),/>IRT \(θ\)<\/th>/);
 assert.match(irtCell(render({})),/81\.33/);
 assert.match(irtCell(render({score_irt:0})),/0\.00/);
 assert.match(irtCell(render({score_irt:null})),/—/);
 const multi=irtCell(render({exams:{scoring_type:'classical,irt_1pl,irt_2pl'},detailed_scores:{irt_1pl:71.69,irt_2pl:0}}));
 assert.match(multi,/IRT 1PL/);assert.match(multi,/71\.69/);assert.match(multi,/IRT 2PL/);assert.match(multi,/0\.00/);
 assert.match(irtCell(render({status:'in_progress'})),/—/);
});
