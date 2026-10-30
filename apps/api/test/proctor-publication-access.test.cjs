const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
require('ts-node').register({project:path.resolve(__dirname,'../tsconfig.json'),transpileOnly:true});
const {fixtureDb}=require('./fixture-db.cjs');
const {AuthorizationService}=require('../src/auth/authorization.service.ts');
const {QuestionBanksService}=require('../src/questions/question-banks.service.ts');
const {QuestionsService}=require('../src/questions/questions.service.ts');
const {BankContentService}=require('../src/questions/bank-content.service.ts');
const {ExamAdminService}=require('../src/proctor/exam-admin.service.ts');
const {ExamKeyCorrectionService}=require('../src/grading/exam-key-correction.service.ts');
const {ValidationsService}=require('../src/validations/validations.service.ts');
const {ProctoringService}=require('../src/proctoring/proctoring.service.ts');
const user=id=>({id,organizationId:'school',roles:id==='proctor'?['PROKTOR']:id==='admin'?['ADMIN']:['GURU']});
const denied=e=>e.getStatus?.()===403;
function fixture(){
 const db=fixtureDb({cbt_question_banks:[
  {id:'own',organization_id:'school',created_by:'proctor',is_published:false},
  {id:'draft',organization_id:'school',created_by:'teacher',is_published:false},
  {id:'public',organization_id:'school',created_by:'teacher',is_published:true},
  {id:'foreign',organization_id:'other',created_by:'teacher',is_published:true}],
  cbt_exams:[{id:'own-exam',created_by:'proctor',is_published:false,organization_id:'school',exam_type:'daily',question_bank_id:'own'},
   {id:'draft-exam',created_by:'teacher',is_published:false,organization_id:'school',exam_type:'daily',question_bank_id:'draft'},
   {id:'public-exam',created_by:'teacher',is_published:true,organization_id:'school',exam_type:'daily',question_bank_id:'public'}],
  cbt_bank_questions:[{id:'q',bank_id:'public',type:'mcq'}],
  cbt_question_bank_validations:[{id:'session',bank_id:'draft',organization_id:'school',bank:{created_by:'teacher',is_published:false}}],
  cbt_question_bank_validators:[{validation_id:'session',validator_id:'proctor'}],
  cbt_exam_question_snapshots:[{exam_id:'public-exam',question_snapshot:{id:'q',bank_id:'public',type:'mcq'}}]});
 const roles={hasOrgRole:async(id,school,allowed)=>school==='school'&&allowed.some(role=>
  ({proctor:['Proktor'],teacher:['Guru'],otherTeacher:['Guru'],admin:['Admin','Proktor']}[id]||[]).includes(role))};
 const auth=new AuthorizationService(db,roles,{assertSchoolId:async id=>{if(id!=='school')throw Object.assign(Error('School denied'),{getStatus:()=>403});return id}});
 const users={emailMap:async()=>new Map()};
 return {db,auth,roles,banks:new QuestionBanksService(db,auth,roles,users),exams:new ExamAdminService(db,auth,roles)};
}
test('proctor reads published foreign banks but only edits owned banks; admins retain all access',async()=>{
 const f=fixture();await f.auth.assertBankAccess(user('proctor'),'public','read');
 await assert.rejects(f.auth.assertBankAccess(user('proctor'),'draft','read'),denied);
 for(const bank of ['draft','public'])await assert.rejects(f.auth.assertBankAccess(user('proctor'),bank),denied);
 await f.auth.assertBankAccess(user('proctor'),'own');
 for(const bank of ['draft','public'])for(const access of ['read','write'])await f.auth.assertBankAccess(user('admin'),bank,access);
 await assert.rejects(f.auth.assertBankAccess(user('admin'),'foreign','read'),denied);
 await f.auth.assertBankAccess(user('teacher'),'draft');
 await assert.rejects(f.auth.assertBankAccess(user('otherTeacher'),'public','read'),denied);
});
test('foreign bank reads work across questions/content while direct mutations are denied without writes',async()=>{
 const f=fixture(),q=new QuestionsService(f.db,f.auth,{}),content=new BankContentService(f.db,f.auth);
 assert.equal((await q.listByBank(user('proctor'),'public')).length,1);
 await content.listStimuli(user('proctor'),'public');
 for(const action of [()=>q.save(user('proctor'),{bankId:'public'}),()=>q.updateMetadata(user('proctor'),'q',{}),
  ()=>q.remove(user('proctor'),'q','public'),()=>q.reorder(user('proctor'),'public',['q']),
  ()=>f.banks.setPublished(user('proctor'),'public',false),()=>f.banks.remove(user('proctor'),'public'),
  ()=>content.createStimulus(user('proctor'),'public','title','text','request')])await assert.rejects(action,denied);
 assert.equal(f.db.writes.length,0);
 assert.equal((await f.banks.get(user('proctor'),'public')).canManage,false);
 assert.equal((await f.banks.get(user('admin'),'public')).canManage,true);
});
test('bank and exam listings hide foreign drafts for proctors and preserve administrator access',async()=>{
 const f=fixture();
 assert.deepEqual((await f.banks.list(user('proctor'),'school')).map(b=>b.id),['own','public']);
 const proctorExams=await f.exams.list(user('proctor'),'school');
 assert.deepEqual(proctorExams.map(e=>e.id),['own-exam','public-exam']);
 assert.equal(proctorExams.find(e=>e.id==='public-exam').canCorrectKeys,false);
 assert.equal((await f.banks.list(user('admin'),'school')).length,3);
 assert.equal((await f.exams.list(user('admin'),'school')).length,3);
});
test('direct monitoring and management of foreign draft exams are denied for proctors only',async()=>{
 const f=fixture();
 await assert.rejects(f.auth.assertExamMonitoring(user('proctor'),'draft-exam'),denied);
 await assert.rejects(f.auth.assertExamStaff(user('proctor'),'draft-exam'),denied);
 for(const id of ['own-exam','public-exam']) await f.auth.assertExamMonitoring(user('proctor'),id);
 await f.auth.assertExamStaff(user('proctor'),'own-exam');
 await assert.rejects(f.auth.assertExamStaff(user('proctor'),'public-exam'),denied);
 await f.auth.assertExamMonitoring(user('admin'),'draft-exam');await f.auth.assertExamStaff(user('admin'),'draft-exam');
 await f.auth.assertExamStaff(user('teacher'),'draft-exam');
});
test('validation assignment and exam-key correction cannot bypass ownership and publication rules',async()=>{
 const f=fixture();
 await assert.rejects(new ValidationsService(f.db,f.auth).getReviewData(user('proctor'),'session'),denied);
 const correction=new ExamKeyCorrectionService(f.db,f.auth,{});
 await assert.rejects(correction.get(user('proctor'),'public-exam'),denied);
 assert.equal(f.db.writes.length,0);
});
test('reset requires proctor authorship even for published exams; administrators and author teachers keep access',async()=>{
 const f=fixture();
 await f.auth.assertExamStaff(user('proctor'),'own-exam','reset');
 for(const exam of ['draft-exam','public-exam'])await assert.rejects(f.auth.assertExamStaff(user('proctor'),exam,'reset'),denied);
 for(const exam of ['own-exam','draft-exam','public-exam'])await f.auth.assertExamStaff(user('admin'),exam,'reset');
 for(const exam of ['draft-exam','public-exam'])await f.auth.assertExamStaff(user('teacher'),exam,'reset');
 const exams=await f.exams.list(user('proctor'),'school');
 assert.equal(exams.find(e=>e.id==='own-exam').canResetParticipants,true);
 assert.equal(exams.find(e=>e.id==='public-exam').canResetParticipants,false);
 assert.ok((await f.exams.list(user('admin'),'school')).every(e=>e.canResetParticipants===true));
});
test('direct recovery and makeup endpoints deny foreign exam resets without touching attempts or answers',async()=>{
 const f=fixture();
 f.db.tables.cbt_exam_attempts=[{id:'attempt',exam_id:'public-exam',status:'submitted'}];
 const service=new ProctoringService(f.db,f.auth,{});
 await assert.rejects(service.resetAttempt(user('proctor'),'attempt','Pemulihan peserta',30),denied);
 await assert.rejects(service.startMakeupAttempt(user('proctor'),'attempt','Ujian susulan',30),denied);
 assert.equal(f.db.writes.length,0);
 assert.equal(f.db.tables.cbt_exam_attempts[0].status,'submitted');
});


for (const permission of ['viewer', 'editor', 'manager']) test(`bank collaborator ${permission} cannot expose private banks or grant a proctor edit rights`, async () => {
 const f=fixture();
 f.db.tables.cbt_bank_collaborators=['draft','public'].map(bank_id=>({bank_id,user_id:'proctor',permission}));
 const banks=await f.banks.list(user('proctor'),'school');
 assert.deepEqual(banks.map(bank=>bank.id),['own','public']);
 const publicBank=banks.find(bank=>bank.id==='public');
 assert.deepEqual([publicBank.canManage,publicBank.canShare,publicBank.canDelete,publicBank.collaborationPermission],[false,false,false,null]);
 assert.equal((await f.banks.get(user('proctor'),'public')).canManage,false);
 await assert.rejects(f.banks.get(user('proctor'),'draft'),denied);
 const questions=new QuestionsService(f.db,f.auth,{}),content=new BankContentService(f.db,f.auth);
 await assert.rejects(questions.listByBank(user('proctor'),'draft'),denied);
 for(const action of [()=>f.banks.update(user('proctor'),'public',{title:'Unauthorized'}),
  ()=>f.banks.setPublished(user('proctor'),'public',false),()=>f.banks.remove(user('proctor'),'public'),
  ()=>f.banks.moveToFolder(user('proctor'),['public'],null),()=>questions.save(user('proctor'),{bankId:'public'}),
  ()=>questions.updateMetadata(user('proctor'),'q',{}),()=>questions.reorder(user('proctor'),'public',['q']),
  ()=>questions.remove(user('proctor'),'q','public'),()=>content.createStimulus(user('proctor'),'public','title','text','request')]) await assert.rejects(action,denied);
 const {CollaborationService}=require('../src/auth/collaboration.service.ts');
 const shares=new CollaborationService(f.db,f.auth);
 await assert.rejects(shares.list(user('proctor'),'bank','draft'),denied);
 await assert.rejects(shares.save(user('proctor'),'bank','public','otherTeacher',{permission:'editor'}),denied);
 assert.equal(f.db.writes.length,0);
});

test('withdrawing a published bank immediately removes proctor access despite a legacy manager grant',async()=>{
 const f=fixture();f.db.tables.cbt_bank_collaborators=[{bank_id:'public',user_id:'proctor',permission:'manager'}];
 await f.auth.assertBankAccess(user('proctor'),'public','read');
 f.db.tables.cbt_question_banks.find(bank=>bank.id==='public').is_published=false;
 assert.deepEqual((await f.banks.list(user('proctor'),'school')).map(bank=>bank.id),['own']);
 await assert.rejects(f.banks.get(user('proctor'),'public'),denied);
 const {CollaborationService}=require('../src/auth/collaboration.service.ts');
 await assert.rejects(new CollaborationService(f.db,f.auth).list(user('proctor'),'bank','public'),denied);
});

test('proctors keep their own draft banks and administrators retain full school access',async()=>{
 const f=fixture();
 for(const id of ['proctor','admin']){
  const own=await f.banks.get(user(id),'own');assert.equal(own.canManage,true);assert.equal(own.canShare,true);
 }
 assert.deepEqual((await f.banks.list(user('proctor'),'school',true)).map(bank=>bank.id),['public']);
 const own=await f.banks.get(user('proctor'),'own');assert.equal(own.is_published,false);
 const original=f.roles.hasOrgRole;
 f.roles.hasOrgRole=async(id,school,allowed)=>id==='proctor'&&school==='school'&&allowed.includes('Guru')||await original(id,school,allowed);
 await assert.rejects(f.auth.assertBankAccess(user('proctor'),'public','write'),denied);
});
