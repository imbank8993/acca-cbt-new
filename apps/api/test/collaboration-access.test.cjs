const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { AuthorizationService } = require('../src/auth/authorization.service.ts');
const { CollaborationService } = require('../src/auth/collaboration.service.ts');
const { QuestionBanksService } = require('../src/questions/question-banks.service.ts');
const { ExamAdminService } = require('../src/proctor/exam-admin.service.ts');
const { collaborativeIds } = require('../src/common/collaboration-access.ts');
const user = id => ({ id, isPlatformAdmin: false });
function fixture(fail = []) {
 const staff = ['a','b','c','manager','admin'];
 const db = fixtureDb({
  cbt_question_banks:[{id:'bank',organization_id:'school',created_by:'a',is_published:false,title:'Shared bank'}],
  cbt_exams:[{id:'exam',organization_id:'school',created_by:'a',is_published:false,exam_type:'daily',title:'Shared exam'}],
  cbt_profiles:staff.map(id=>({id,full_name:id})),
  cbt_organization_members:staff.map(id=>({id:'member-'+id,user_id:id,organization_id:'school',is_active:true,profiles:{full_name:id},member_roles:[{roles:{name:id==='admin'?'Admin':'Guru'}}]})),
  cbt_bank_collaborators:[],cbt_exam_collaborators:[],cbt_collaboration_events:[],
 },fail);
 const roles = {hasOrgRole:async(id,org,allowed)=>org==='school' && staff.includes(id) && allowed.includes(id==='admin'?'Admin':'Guru')};
 const scope = {assertSchoolId:async id=>{if(id!=='school')throw Error('wrong school');return id;}};
 const auth = new AuthorizationService(db,roles,scope);
 return {db,roles,auth,staff,service:new CollaborationService(db,auth)};
}
for(const type of ['bank','exam']) test(`${type}: owner adds a reader, editors are separate, revocation stops the next request`, async()=>{
 const f=fixture(),id=type;
 await f.service.save(user('a'),type,id,'b',{permission:'viewer'});
 assert.equal(f.db.tables.cbt_collaboration_events.length,1);
 if(type==='bank') {
  await f.auth.assertBankAccess(user('b'),id,'read');
  await assert.rejects(f.auth.assertBankAccess(user('b'),id),/sendiri/);
 } else {
  await f.auth.assertExamMonitoring(user('b'),id);
  await assert.rejects(f.auth.assertExamStaff(user('b'),id),/sendiri/);
 }
 await assert.rejects(f.service.save(user('b'),type,id,'c',{permission:'editor'}),/Hanya/);
 await f.service.save(user('a'),type,id,'b',{permission:'editor'});
 if(type==='bank') await f.auth.assertBankAccess(user('b'),id);
 else await f.auth.assertExamStaff(user('b'),id);
 await f.service.revoke(user('a'),type,id,'b');
 if(type==='bank') await assert.rejects(f.auth.assertBankAccess(user('b'),id,'read'),/sendiri/);
 else await assert.rejects(f.auth.assertExamMonitoring(user('b'),id),/izin/);
 await assert.rejects(f.service.list(user('b'),type,id),/akses/);
 assert.deepEqual(await collaborativeIds(f.db,type,'b'),[]);
});
test('bank permission never grants exam management or reset, and exam permission never grants bank access',async()=>{
 const f=fixture();
 await f.service.save(user('a'),'bank','bank','b',{permission:'manager'});
 await assert.rejects(f.auth.assertExamStaff(user('b'),'exam'),/sendiri/);
 await f.service.save(user('a'),'exam','exam','c',{permission:'editor'});
 await f.auth.assertExamStaff(user('c'),'exam');
 await assert.rejects(f.auth.assertBankAccess(user('c'),'bank','read'),/sendiri/);
 assert.equal(await f.auth.getExamResetScope(user('c'),f.db.tables.cbt_exams[0]),null);
 await f.service.save(user('a'),'exam','exam','c',{permission:'editor',can_reset:true});
 assert.equal((await f.auth.getExamResetScope(user('c'),f.db.tables.cbt_exams[0])).allParticipants,true);
 await f.service.revoke(user('a'),'exam','exam','c');
 assert.equal(await f.auth.getExamResetScope(user('c'),f.db.tables.cbt_exams[0]),null);
});
test('delegated managers cannot replace owners, promote managers, reset, or edit other managers',async()=>{
 const f=fixture();
 await f.service.save(user('a'),'exam','exam','manager',{permission:'manager'});
 await f.service.save(user('manager'),'exam','exam','b',{permission:'editor'});
 await assert.rejects(f.service.save(user('manager'),'exam','exam','c',{permission:'manager'}),/Hanya/);
 await assert.rejects(f.service.save(user('manager'),'exam','exam','c',{permission:'editor',can_reset:true}),/Hanya/);
 await assert.rejects(f.service.revoke(user('manager'),'exam','exam','a'),/pembuat/);
 await assert.rejects(f.service.save(user('manager'),'exam','exam','manager',{permission:'viewer'}),/pengelola lain/);
 await f.service.revoke(user('a'),'exam','exam','manager');
 await assert.rejects(f.service.save(user('manager'),'exam','exam','c',{permission:'editor'}),/Hanya/);
});
test('expired access is denied and only active staff can receive grants',async()=>{
 const f=fixture();
 await f.service.save(user('a'),'bank','bank','b',{permission:'editor'});
 f.db.tables.cbt_bank_collaborators[0].expires_at='2000-01-01T00:00:00Z';
 await assert.rejects(f.auth.assertBankAccess(user('b'),'bank'),/sendiri/);
 await assert.rejects(f.service.save(user('a'),'bank','bank','b',{permission:'editor',expires_at:'bad'}),/Batas/);
 await assert.rejects(f.service.save(user('a'),'bank','bank','b',{permission:'editor',expires_at:'2000-01-01'}),/Batas/);
 f.db.tables.cbt_organization_members.find(x=>x.user_id==='b').is_active=false;
 await assert.rejects(f.service.save(user('a'),'bank','bank','b',{permission:'editor'}),/aktif/);
 await assert.rejects(f.service.save(user('a'),'bank','bank','stranger',{permission:'editor'}),/aktif/);
 await assert.rejects(f.service.save(user('a'),'bank','bank','c',{permission:'editor',can_reset:true}),/reset/);
 await assert.rejects(f.service.save(user('a'),'exam','exam','c',{permission:'viewer',can_reset:true}),/Pembaca/);
});
test('admin can hand over access after the creator loses staff status without changing attribution',async()=>{
 const f=fixture();f.staff.splice(f.staff.indexOf('a'),1);
 await assert.rejects(f.service.save(user('a'),'bank','bank','b',{permission:'editor'}),/izin/);
 await f.service.save(user('admin'),'bank','bank','b',{permission:'manager'});
 await f.auth.assertBankAccess(user('b'),'bank');
 assert.equal(f.db.tables.cbt_question_banks[0].created_by,'a');
 await assert.rejects(f.auth.assertResourceOwner(user('b'),'bank','bank'),/Hanya/);
 await f.auth.assertResourceOwner(user('admin'),'bank','bank');
});
test('audit failure rolls back grant mutations',async()=>{
 const f=fixture(['cbt_collaboration_events']);
 await assert.rejects(f.service.save(user('a'),'bank','bank','b',{permission:'editor'}),/Riwayat/);
 assert.equal(f.db.tables.cbt_bank_collaborators.length,0);
});
test('shared drafts appear for readers, with edit and delete controls disabled',async()=>{
 const f=fixture();
 await f.service.save(user('a'),'bank','bank','b',{permission:'viewer'});
 const banks=new QuestionBanksService(f.db,f.auth,f.roles,{emailMap:async()=>new Map()});
 const listed=await banks.list(user('b'),'school');
 assert.equal(listed[0].id,'bank');assert.equal(listed[0].canManage,false);assert.equal(listed[0].canDelete,false);
 await f.service.save(user('a'),'exam','exam','b',{permission:'viewer'});
 const exams=new ExamAdminService(f.db,f.auth,f.roles);
 const examList=await exams.list(user('b'),'school');
 assert.equal(examList[0].id,'exam');assert.equal(examList[0].canManage,false);assert.equal(examList[0].canShare,false);
});

test('stale bank metadata cannot overwrite another editor and revoked editors cannot save',async()=>{
 const f=fixture(); const stamp='2026-10-23T01:00:00.000Z';
 f.db.tables.cbt_question_banks[0].updated_at=stamp;
 await f.service.save(user('a'),'bank','bank','b',{permission:'editor'});
 const banks=new QuestionBanksService(f.db,f.auth,f.roles,{emailMap:async()=>new Map()});
 await banks.update(user('b'),'bank',{title:'B edited',expectedUpdatedAt:stamp});
 await assert.rejects(banks.update(user('a'),'bank',{title:'Stale A',expectedUpdatedAt:stamp}),/telah diubah/);
 assert.equal(f.db.tables.cbt_question_banks[0].title,'B edited');
 await f.service.revoke(user('a'),'bank','bank','b');
 await assert.rejects(banks.update(user('b'),'bank',{title:'Revoked edit'}),/sendiri/);
 assert.equal(f.db.tables.cbt_question_banks[0].title,'B edited');
});
test('stale exam metadata is rejected before any changes',async()=>{
 const f=fixture();f.db.tables.cbt_exams[0].updated_at='2026-10-23T02:00:00.000Z';
 await f.service.save(user('a'),'exam','exam','b',{permission:'editor'});
 const exams=new ExamAdminService(f.db,f.auth,f.roles);
 await assert.rejects(exams.update(user('b'),'exam',{title:'stale',expectedUpdatedAt:'2026-10-23T01:00:00.000Z'}),/telah diubah/);
 assert.equal(f.db.tables.cbt_exams[0].title,'Shared exam');
});
test('room-only invigilators cannot read complete class assignments through the staff assignment endpoint',async()=>{
 const f=fixture(); const exams=new ExamAdminService(f.db,f.auth,f.roles);
 await assert.rejects(exams.listAssignments(user('stranger'),['exam']),/izin/);
 await f.service.save(user('a'),'exam','exam','b',{permission:'viewer'});
 const assignments=await exams.listAssignments(user('b'),['exam']);
 assert.deepEqual(assignments,{targets:[],participants:[]});
});
