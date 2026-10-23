const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { CbtRolesService } = require('../src/auth/cbt-roles.service.ts');
const { AuthorizationService } = require('../src/auth/authorization.service.ts');
function fixture() {
 const db = fixtureDb({
  cbt_organization_members: [{id:'m',user_id:'u',organization_id:'school',is_active:true,member_roles:[]}],
  cbt_pas_periods:[{id:'p',organization_id:'school'}],
  cbt_pas_rooms:[{id:'r',pas_period_id:'p'}],
  cbt_pas_sessions:[{id:'s',pas_period_id:'p'}],
  cbt_pas_room_invigilators:[{user_id:'u',pas_room_id:'r',session_id:'s',exam_date:'2026-10-23'}],
 });
 const scope={getSchool:async()=>({id:'school',name:'School'}),assertSchoolId:async id=>{assert.equal(id,'school');return id;}};
 const roles=new CbtRolesService(db,scope);
 return {db,roles,auth:new AuthorizationService(db,roles,scope)};
}
test('assignment enables the workspace without any SSO or membership Pengawas role; revocation is immediate',async()=>{
 const {db,roles,auth}=fixture();
 assert.equal((await roles.resolve('u','u@example.test')).resolved.pengawas,true);
 assert.equal(await roles.hasOrgRole('u','school',['Pengawas']),true);
 await auth.assertOrgMonitoring({id:'u'},'school');
 db.tables.cbt_pas_room_invigilators=[];
 assert.equal((await roles.resolve('u','u@example.test')).resolved.pengawas,false);
 assert.equal(await roles.hasOrgRole('u','school',['Pengawas']),false);
 await assert.rejects(auth.assertOrgMonitoring({id:'u'},'school'),/izin/);
});
test('legacy Pengawas role and metadata cannot grant access without a duty',async()=>{
 const {db,roles}=fixture(); db.tables.cbt_pas_room_invigilators=[];
 db.tables.cbt_organization_members[0].member_roles=[{roles:{name:'Pengawas'}}];
 const context=await roles.resolve('u','u@example.test',{role:'PENGAWAS'});
 assert.equal(context.resolved.pengawas,false);
 assert.equal(context.roleNames.includes('PENGAWAS'),false);
 assert.equal(await roles.hasOrgRole('u','school',['Pengawas']),false);
});
test('inactive memberships, foreign periods and mismatched sessions cannot grant the workspace',async()=>{
 for(const mutate of [db=>db.tables.cbt_organization_members[0].is_active=false, db=>db.tables.cbt_pas_periods[0].organization_id='other', db=>db.tables.cbt_pas_sessions[0].pas_period_id='other']){
  const {db,roles}=fixture();mutate(db);
  assert.equal((await roles.resolve('u','u@example.test')).resolved.pengawas,false);
  assert.equal(await roles.hasOrgRole('u','school',['Pengawas']),false);
 }
});

test('an active member without a role can be appointed by the proctor',async()=>{
 const {db,roles}=fixture();db.tables.cbt_pas_room_invigilators=[];
 db.tables.cbt_pas_periods[0].start_date='2026-10-20';db.tables.cbt_pas_periods[0].end_date='2026-10-25';
 const { PasRoomsService }=require('../src/pas/pas-rooms.service.ts');
 const rooms=new PasRoomsService(db,{assertProktorByRecord:async()=>{},assertProktorByParent:async()=>{}});
 await rooms.assignInvigilators({id:'manager'},'r',['u'],'s','2026-10-23');
 assert.equal(await roles.hasOrgRole('u','school',['Pengawas']),true);
});
