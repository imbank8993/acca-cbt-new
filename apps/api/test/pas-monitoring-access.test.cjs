const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { assignedPasExamIds } = require('../src/common/pas-monitoring-access.ts');
const { AuthorizationService } = require('../src/auth/authorization.service.ts');
const { ExamAdminService } = require('../src/proctor/exam-admin.service.ts');
const { sortMonitoringExams, isMonitoringExamActive, monitoringExamLabel } = require('../../web/lib/monitoring-exams.ts');
function fixture() {
 return fixtureDb({
  cbt_pas_room_invigilators: [{user_id:'teacher',pas_room_id:'r1',session_id:'s1'}, {user_id:'teacher',pas_room_id:'r2',session_id:'s2'}],
  cbt_pas_rooms:[{id:'r1',name:'Ruang A',pas_period_id:'p1'},{id:'r2',name:'Ruang B',pas_period_id:'p2'}],
  cbt_pas_periods:[{id:'p1',organization_id:'school'},{id:'p2',organization_id:'other'}],
  cbt_pas_class_schedules:[{pas_period_id:'p1',session_id:'s1',room:'Ruang A',exam_id:'e1'},{pas_period_id:'p2',session_id:'s2',room:'Ruang B',exam_id:'e2'}, {pas_period_id:'p1',session_id:'s2',room:'Ruang A',exam_id:'wrong-session'}, {pas_period_id:'p1',session_id:'s1',room:'Ruang B',exam_id:'wrong-room'}],
  cbt_exams:[{id:'e1',organization_id:'school',created_by:'admin',exam_type:'pas'}, {id:'e3',organization_id:'school',created_by:'admin',exam_type:'pas'}],
 });
}
const roles={hasOrgRole:async (id,org,allowed)=>org==='school' && allowed.includes('Guru')};
const scope={assertSchoolId:async id=>{assert.equal(id,'school');return id;}};
const user={id:'teacher',isPlatformAdmin:false};
test('assigned PAS exams are school scoped and assignment removal revokes access',async()=>{
 const db=fixture();
 assert.deepEqual(await assignedPasExamIds(db,'teacher','school'),['e1']);
 const auth=new AuthorizationService(db,roles,scope);
 await auth.assertExamMonitoring(user,'e1');
 await assert.rejects(auth.assertExamMonitoring(user,'e3'),/izin/);
 db.tables.cbt_pas_room_invigilators=[];
 await assert.rejects(auth.assertExamMonitoring(user,'e1'),/izin/);
});

test('monitoring permission requires the assigned room and session; legacy unscoped assignments grant nothing', async () => {
 const db = fixture();
 assert.deepEqual(await assignedPasExamIds(db, 'teacher', 'school'), ['e1']);
 db.tables.cbt_pas_room_invigilators.push({ user_id: 'teacher', pas_room_id: 'r1', session_id: 's2' });
 assert.deepEqual(await assignedPasExamIds(db, 'teacher', 'school'), ['e1', 'wrong-session']);
 db.tables.cbt_pas_room_invigilators = [{ user_id: 'teacher', pas_room_id: 'r1', session_id: null }];
 assert.deepEqual(await assignedPasExamIds(db, 'teacher', 'school'), []);
});
test('teacher discovery includes assigned PAS exam IDs in its ownership filter',async()=>{
 const db=fixture();
 const service=new ExamAdminService(db,new AuthorizationService(db,roles,scope),roles);
 await service.list(user,'school');
 // The fixture records OR expressions; the real adapter evaluates them.
 const query=db.queries.find(q=>q.table==='cbt_exams');
 assert.deepEqual(query.calls.find(call=>call[0]==='or'), ['or','created_by.eq.teacher,id.in.(e1)']);
 assert.ok(query.calls.some(call=>call[0]==='eq' && call[1]==='organization_id' && call[2]==='school'));
});
test('active schedules first then alphabetical with exclusive end boundary',()=>{
 const now=Date.parse('2026-10-08T00:00:00Z');
 const active={is_published:true,status:'scheduled',start_time:'2026-10-07T23:00:00Z',end_time:'2026-10-08T01:00:00Z'};
 const rows=[{...active,id:'z',title:'Zoologi'},{...active,id:'b',title:'Biologi'}, {...active,id:'a',title:'Agama',status:'archived'}];
 assert.deepEqual(sortMonitoringExams(rows,now).map(e=>e.id),['b','z','a']);
 assert.deepEqual(rows.map(e=>e.id),['z','b','a']);
 assert.equal(monitoringExamLabel(rows[0]), 'Zoologi');
 assert.equal(isMonitoringExamActive({...active,end_time:'2026-10-08T00:00:00Z'},now),false);
 assert.equal(isMonitoringExamActive({...active,is_published:false},now),false);
 assert.equal(isMonitoringExamActive({...active,start_time:'invalid'},now),false);
 assert.equal(isMonitoringExamActive({...active,status:'finished'},now),false);
});
