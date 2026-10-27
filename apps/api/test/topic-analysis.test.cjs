const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
require('ts-node').register({project:path.resolve(__dirname,'../tsconfig.json'),transpileOnly:true});
const {buildTopicAnalysis,questionTopic}=require('@acca-cbt/shared');
const {withQuestionTopics}=require('../src/common/exam-question-topics.ts');
const {StudentsService}=require('../src/students/students.service.ts');
const {ExamMonitoringService}=require('../src/proctor/exam-monitoring.service.ts');
const {ExamReviewService}=require('../src/analytics/exam-review.service.ts');
const {fixtureDb}=require('./fixture-db.cjs');
const q=(id,topic='Persamaan trigonometri',extra={})=>({id,type:'mcq',score_default:1,topic,question_text:'Pertanyaan',...extra});
const response=(participantId,questionId,isCorrect,answered=true)=>({participantId,questionId,isCorrect,answered});

test('materi hanya diambil dari nama yang diisi guru, dengan prioritas kisi-kisi resmi',()=>{
 assert.equal(questionTopic(q('q',null,{kisi_kisi:{materi:'  Persamaan   Trigonometri  '},metadata:{topic:'Lama'}})),'Persamaan Trigonometri');
 assert.equal(questionTopic(q('q',null,{metadata:{kisi_kisi_data:{materi:'<b>Logika</b> &amp; Himpunan'}}})),'Logika & Himpunan');
 assert.equal(questionTopic(q('q',null,{metadata:{topic:'Peluang'}})),'Peluang');
 assert.equal(questionTopic(q('q',null,{question_text:'Persamaan trigonometri',metadata:{kisi_kisi:'Indikator panjang tanpa nama materi'}})),null);
});
test('rekap lintas peserta memasukkan kosong, memisahkan koreksi tertunda, dan menggabungkan variasi nama',()=>{
 const questions=[q('q1'),q('q2',' persamaan  TRIGONOMETRI '),q('q3',null)];
 const result=buildTopicAnalysis(questions,['a','b','a'],[
  response('a','q1',true),response('a','q2',false),response('b','q1',null),response('outside','q1',true),
 ]);
 assert.equal(result.participantCount,2);assert.equal(result.mappedQuestions,2);assert.equal(result.unmappedQuestions,1);
 assert.deepEqual(result.topics[0],{name:'Persamaan trigonometri',questionCount:2,participantCount:2,correct:1,incorrect:1,unanswered:1,pending:1,assessed:3,percentage:100/3});
});
test('materi diprioritaskan dari ketepatan terendah; hanya penilaian tertunda tidak dianggap nol',()=>{
 const result=buildTopicAnalysis([q('q1','A'),q('q2','B'),q('q3','C')],['a'],[response('a','q1',true),response('a','q2',false),response('a','q3',null)]);
 assert.deepEqual(result.topics.map(t=>[t.name,t.percentage]),[['B',0],['A',100],['C',null]]);
});
test('soal dibatalkan, bobot nol, dan kepribadian dikecualikan dari ringkasan serta cakupan',()=>{
 const result=buildTopicAnalysis([q('q1'),q('void',null,{metadata:{score_excluded:true}}),q('personality','Karakter',{type:'likert'}),q('zero','Nol',{score_default:0})],['a'],[response('a','q1',true)]);
 assert.equal(result.mappedQuestions,1);assert.equal(result.unmappedQuestions,0);assert.equal(result.topics.length,1);assert.equal(result.topics[0].percentage,100);
});
test('peserta dan soal duplikat tidak menggandakan observasi, jawaban kosong bukan benar',()=>{
 const result=buildTopicAnalysis([q('q'),q('q')],['a','a'],[response('a','q',true,false)]);
 assert.equal(result.topics[0].questionCount,1);assert.equal(result.topics[0].unanswered,1);assert.equal(result.topics[0].correct,0);
});
test('tanpa materi atau peserta tidak menghasilkan rekomendasi yang dibuat-buat',()=>{
 assert.deepEqual(buildTopicAnalysis([q('q',null)],[],[]),{participantCount:0,mappedQuestions:0,unmappedQuestions:1,topics:[]});
 assert.equal(buildTopicAnalysis([q('q')],[],[]).topics[0].percentage,null);
});
test('snapshot lama memperoleh label kisi-kisi tanpa mengubah kunci, bobot, atau teks; label beku dipertahankan',async()=>{
 const db=fixtureDb({cbt_bank_questions:[q('old',null,{kisi_kisi:{materi:'Persamaan trigonometri'}}),q('frozen','Topik berubah')]});
 const original=q('old',null,{metadata:{correct_answer:'RAHASIA'},score_default:5});
 const [enriched,frozen]=await withQuestionTopics(db,[original,q('frozen','Materi beku')]);
 assert.equal(enriched.topic,'Persamaan trigonometri');assert.equal(enriched.score_default,5);assert.equal(enriched.metadata.correct_answer,'RAHASIA');assert.equal(original.topic,null);
 assert.equal(frozen.topic,'Materi beku');assert.equal(db.writes.length,0);
});
function resultFixture(){
 const exam={id:'e',question_bank_id:'bank',show_results:true,scoring_type:'classical',end_time:'2026-09-19T00:00:00Z',metadata:{show_answer_keys:true}};
 const questions=[q('q1'),q('q2','Peluang'),q('q3',null)];
 const db=fixtureDb({cbt_exams:[exam],cbt_exam_attempts:[{id:'a',exam_id:'e',user_id:'student',status:'submitted',total_score:50,exams:exam}],
  cbt_exam_question_snapshots:questions.map((question_snapshot,i)=>({exam_id:'e',order_number:i+1,question_snapshot})),
  cbt_answers:[{id:'ans',attempt_id:'a',question_id:'q1',selected_option_id:'option',is_correct:false,score:0},
   {id:'foreign',attempt_id:'other',question_id:'q1',selected_option_id:'option',is_correct:true,score:1}]});
 return {db,service:new StudentsService(db)};
}
test('hasil pribadi memakai jawaban sendiri termasuk soal kosong, dan menyertakan nama materi',async()=>{
 const {db,service}=resultFixture();const result=await service.getAttemptDetails({id:'student'},'a');
 assert.equal(result.topicAnalysis.participantCount,1);assert.equal(result.topicAnalysis.topics.find(t=>t.name==='Persamaan trigonometri').incorrect,1);
 assert.equal(result.topicAnalysis.topics.find(t=>t.name==='Peluang').unanswered,1);assert.equal(result.answers[0].question.topic,'Persamaan trigonometri');
 assert.equal(result.topicAnalysis.unmappedQuestions,1);assert.equal(db.writes.length,0);
});
test('ringkasan materi siswa tidak membocorkan hasil ketika pembahasan ditutup atau ke pengguna lain',async()=>{
 const {db,service}=resultFixture();db.tables.cbt_exam_attempts[0].exams.metadata.show_answer_keys=false;
 const result=await service.getAttemptDetails({id:'student'},'a');assert.equal(result.answerKeysReleased,false);assert.equal(result.topicAnalysis,undefined);
 await assert.rejects(service.getAttemptDetails({id:'other'},'a'),e=>e.getStatus()===403);
 db.tables.cbt_exam_attempts[0].exams.show_results=false;
 await assert.rejects(service.getAttemptDetails({id:'student'},'a'),e=>e.getStatus()===403);
});
test('review siswa menampilkan ringkasan dan materi dengan aturan akses yang sama',async()=>{
 const {db}=resultFixture();const service=new ExamReviewService(db,{assertExamStaff:async()=>{throw Error('denied')}});
 const review=await service.getReview({id:'student'},'a');
 assert.equal(review.topicAnalysis.participantCount,1);assert.equal(review.questions[0].metadata.topic,'Persamaan trigonometri');
 db.tables.cbt_exam_attempts[0].exams.metadata.show_answer_keys=false;
 await assert.rejects(service.getReview({id:'student'},'a'),e=>e.getStatus()===403);
});
for(const restricted of [false,true])test(`monitoring materi memakai peserta selesai dan lingkup akses ${restricted?'ruang pengawas':'seluruh ujian'}`,async()=>{
 const {db}=resultFixture();db.tables.cbt_exam_attempts.push({id:'b',exam_id:'e',user_id:'outside',status:'submitted',profiles:{full_name:'B',identity_number:'2'}},{id:'active',exam_id:'e',user_id:'active',status:'in_progress'});
 db.tables.cbt_answers.push({id:'b-ans',attempt_id:'b',question_id:'q1',selected_option_id:'option',is_correct:true},{id:'active-ans',attempt_id:'active',question_id:'q1',selected_option_id:'option',is_correct:true});
 const service=new ExamMonitoringService(db,{assertExamMonitoring:async()=>restricted?['student']:undefined},{post:async()=>null},{},{});
 service.loadAssignedStudents=async()=>({classByUser:new Map()});
 const result=await service.getItemAnalysis({id:'staff'},'e');
 assert.equal(result.topicAnalysis.participantCount,restricted?1:2);
 const material=result.topicAnalysis.topics.find(t=>t.name==='Persamaan trigonometri');
 assert.equal(material.correct,restricted?0:1);assert.equal(material.incorrect,1);
 assert.equal(result.questions[0].topic,'Persamaan trigonometri');
});

test('nama materi dan ringkasan diteruskan adapter hasil siswa ke halaman',async()=>{
 const fs=require('fs'),ts=require('typescript');
 const source=fs.readFileSync(path.resolve(__dirname,'../../web/lib/api/students.ts'),'utf8');
 const ast=ts.createSourceFile('students.ts',source,ts.ScriptTarget.Latest,true);
 const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='getAttemptDetailsResult');
 const code=ts.transpileModule(`${fn.getText(ast).replace('export ','')}\nmodule.exports=getAttemptDetailsResult;`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const topicAnalysis=buildTopicAnalysis([q('q')],['a'],[response('a','q',true)]);
 const mod={exports:{}};
 new Function('apiGet','module',code)(async()=>({success:true,answerKeysReleased:true,attempt:{id:'a'},answers:[],dimensions:[],interpretations:[],topicAnalysis}),mod);
 const result=await mod.exports('a');assert.deepEqual(result.details.topicAnalysis,topicAnalysis);
});
test('panel pribadi tidak menampilkan materi buatan; panel staf menjelaskan materi yang belum dipetakan',()=>{
 const fs=require('fs'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const source=fs.readFileSync(path.resolve(__dirname,'../../web/app/components/monitoring/TopicAnalysisPanel.tsx'),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const mod={exports:{}};
 new Function('require','module','exports',code)(name=>name==='react'?React:name==='react/jsx-runtime'?require(name):name==='lucide-react'?{BookOpen:()=>null}:name.endsWith('.css')?{}:{Button:props=>React.createElement('button',{},props.children)},mod,mod.exports);
 const Panel=mod.exports.TopicAnalysisPanel;
 const empty=buildTopicAnalysis([q('q',null)],['a'],[]);
 assert.equal(renderToStaticMarkup(React.createElement(Panel,{analysis:empty,personal:true})),'');
 assert.match(renderToStaticMarkup(React.createElement(Panel,{analysis:empty})),/Isi materi pada kisi-kisi/);
 const summary=buildTopicAnalysis([q('q')],['a'],[response('a','q',false)]);
 const html=renderToStaticMarkup(React.createElement(Panel,{analysis:summary,personal:true}));
 assert.match(html,/Prioritaskan latihan/);assert.match(html,/Persamaan trigonometri/);assert.match(html,/0%/);
});
