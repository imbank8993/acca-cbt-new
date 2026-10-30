const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
require('ts-node').register({project:path.resolve(__dirname,'../tsconfig.json'),transpileOnly:true});
const {fixtureDb}=require('./fixture-db.cjs');
const {createFixtures,signingInput}=require('./pas-administration-fixtures.cjs');
const {AuthorizationService}=require('../src/auth/authorization.service.ts');
const {CollaborationService}=require('../src/auth/collaboration.service.ts');
const {PasService}=require('../src/pas/pas.service.ts');
const {PasRoomsService}=require('../src/pas/pas-rooms.service.ts');
const {PasSchedulesService}=require('../src/pas/pas-schedules.service.ts');
const {PasAdministrationService}=require('../src/pas/pas-administration.service.ts');
const owner={id:'proctor-creator-1',organizationId:'org-1'},other={id:'other-proctor',organizationId:'org-1'},admin={id:'admin',organizationId:'org-1'};
const forbidden=e=>e.getStatus?.()===403;
function fixture(permission,fail=[]){
 const data=createFixtures();
 data.cbt_pas_period_collaborators=permission?[{period_id:'period-1',user_id:other.id,permission,granted_by:owner.id}]:[];
 data.cbt_profiles.push({id:other.id,full_name:'Proktor lain'});
 data.cbt_organization_members=[owner,other,admin].map(u=>({user_id:u.id,organization_id:'org-1',is_active:true,profiles:{full_name:u.id},member_roles:[{roles:{name:u.id==='admin'?'Admin':'Proktor'}}]}));
 const db=fixtureDb(data,fail,{now:'2026-10-17T01:00:00Z'});
 const roles={hasOrgRole:async(id,org,allowed)=>org==='org-1'&&[owner.id,other.id,'admin'].includes(id)&&allowed.includes(id==='admin'?'Admin':'Proktor')};
 const scope={assertSchoolId:async id=>{if(id!=='org-1')throw Object.assign(Error('school denied'),{getStatus:()=>403});return id;}};
 const auth=new AuthorizationService(db,roles,scope);
 return {db,auth,periods:new PasService(db,auth),rooms:new PasRoomsService(db,auth),schedules:new PasSchedulesService(db,auth,{getSchoolTimeZone:async()=> 'Asia/Makassar'}),administration:new PasAdministrationService(db,auth),collaboration:new CollaborationService(db,auth)};
}

test('another proctor can view a PAS folder but cannot mutate it or its children',async()=>{
 const f=fixture();
 const list=await f.periods.listPeriods(other,'org-1');assert.equal(list[0].canManage,false);assert.equal(list[0].canShare,false);assert.equal(list[0].canDelete,false);
 assert.equal((await f.periods.getPeriod(other,'period-1')).canManage,false);
 await f.rooms.listRooms(other,'period-1');await f.schedules.listSessions(other,'period-1');
 const calls=[()=>f.periods.updatePeriod(other,'period-1',{name:'Hacked'}),()=>f.periods.updateCommitteeChair(other,'period-1',{committee_chair_name:'Hacked'}),
 ()=>f.periods.updateExamSettings(other,'period-1',{}),()=>f.periods.setPeriodLock(other,'period-1',true),()=>f.periods.removePeriod(other,'period-1'),
 ()=>f.schedules.createSession(other,'period-1',{}),()=>f.schedules.removeSession(other,'session-1'),()=>f.schedules.addSchedule(other,{pas_period_id:'period-1'}),
 ()=>f.schedules.removeSchedule(other,'sched-1'),()=>f.schedules.setActivation(other,'sched-1',true),()=>f.schedules.mergeExams(other,'period-1'),
 ()=>f.rooms.createRoom(other,'period-1',{}),()=>f.rooms.removeRoom(other,'room-1'),()=>f.rooms.assignInvigilators(other,'room-1',[],'session-1','2026-10-17'),
 ()=>f.rooms.copyInvigilators(other,'period-1','2026-10-17','2026-10-18'),()=>f.rooms.assignStudents(other,'period-1','room-1',[]),()=>f.rooms.removeStudent(other,'period-1','student-1')];
 for(const call of calls)await assert.rejects(call,forbidden);
 const generation=await f.schedules.generate(other,['sched-1']);assert.equal(generation.created,0);
 await assert.rejects(f.administration.saveAdministrationSlot(other,{...signingInput(),action:'save_draft'}),forbidden);
 await assert.rejects(f.administration.approveAdministrationSlot(other,signingInput()),forbidden);
 assert.equal(f.db.writes.length,0);
});

for(const permission of ['viewer','editor','manager'])test(`period collaborator ${permission} has only the explicitly granted rights`,async()=>{
 const f=fixture(permission),canManage=permission!=='viewer';
 const detail=await f.periods.getPeriod(other,'period-1');assert.equal(detail.canManage,canManage);assert.equal(detail.canShare,permission==='manager');assert.equal(detail.canDelete,false);
 assert.equal((await f.periods.listPeriods(other,'org-1'))[0].canManage,canManage);
 if(canManage){await f.periods.updateCommitteeChair(other,'period-1',{committee_chair_name:'Ketua baru'});assert.equal(f.db.tables.cbt_pas_periods[0].committee_chair_name,'Ketua baru');}
 else await assert.rejects(f.periods.updateCommitteeChair(other,'period-1',{committee_chair_name:'Hacked'}),forbidden);
 await assert.rejects(f.periods.removePeriod(other,'period-1'),forbidden);
 for(const invalid of [{revoked_at:'2026-01-01T00:00:00Z'},{expires_at:'2000-01-01T00:00:00Z'}]){Object.assign(f.db.tables.cbt_pas_period_collaborators[0],invalid);await assert.rejects(f.auth.assertProktorByRecord(other,'cbt_pas_periods','period-1'),forbidden);}
});

test('folder ownership and administrator rights remain separate from bank/exam grants',async()=>{
 const f=fixture();for(const user of [owner,admin]){await f.auth.assertPasPeriodManage(user,'period-1');await f.auth.assertPasPeriodManage(user,'period-1','delete');assert.equal((await f.periods.getPeriod(user,'period-1')).canManage,true);}
 f.db.tables.cbt_exam_collaborators=[{exam_id:'exam-1',user_id:other.id,permission:'manager'}];
 f.db.tables.cbt_bank_collaborators=[{bank_id:'bank-1',user_id:other.id,permission:'manager'}];
 await assert.rejects(f.auth.assertPasPeriodManage(other,'period-1'),forbidden);
 f.db.tables.cbt_pas_periods[0].organization_id='other-school';await assert.rejects(f.auth.assertPasPeriodManage(admin,'period-1'),forbidden);
});

test('owner grants and revokes folder collaboration; readers cannot promote themselves',async()=>{
 const f=fixture();await f.collaboration.save(owner,'period','period-1',other.id,{permission:'editor'});
 await f.auth.assertPasPeriodManage(other,'period-1');assert.equal(f.db.tables.cbt_collaboration_events[0].resource_type,'period');
 await assert.rejects(f.collaboration.save(other,'period','period-1',other.id,{permission:'manager'}),forbidden);
 await f.collaboration.revoke(owner,'period','period-1',other.id);await assert.rejects(f.auth.assertPasPeriodManage(other,'period-1'),forbidden);
 await assert.rejects(f.collaboration.save(owner,'period','period-1',other.id,{permission:'editor',can_reset:true}),/reset/);
});

test('folder permission lookup failure denies writes',async()=>{
 const f=fixture(undefined,['cbt_pas_period_collaborators']);await assert.rejects(f.auth.assertPasPeriodManage(other,'period-1'));assert.equal(f.db.writes.length,0);
});
