const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { assignedPasExamIds } = require('../src/common/pas-monitoring-access.ts');
const { AuthorizationService } = require('../src/auth/authorization.service.ts');
const { ExamAdminService } = require('../src/proctor/exam-admin.service.ts');
const { ExamMonitoringService } = require('../src/proctor/exam-monitoring.service.ts');
const { loadPasParticipantLocations } = require('../src/common/pas-participant-location.ts');
const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');
const { sortMonitoringExams, isMonitoringExamActive, monitoringExamLabel } = require('../../web/lib/monitoring-exams.ts');
function fixture() {
 return fixtureDb({
  cbt_pas_room_invigilators: [{user_id:'teacher',pas_room_id:'r1',session_id:'s1', exam_date: '2026-10-20' }, {user_id:'teacher',pas_room_id:'r2',session_id:'s2', exam_date: '2026-10-20' }],
  cbt_pas_rooms:[{id:'r1',name:'Ruang A',pas_period_id:'p1'},{id:'r2',name:'Ruang B',pas_period_id:'p2'}],
  cbt_pas_periods:[{id:'p1',organization_id:'school'},{id:'p2',organization_id:'other'}],
  cbt_pas_class_schedules:[{pas_period_id:'p1',session_id:'s1',room:'Ruang A',exam_id:'e1', scheduled_date: '2026-10-20' },{pas_period_id:'p2',session_id:'s2',room:'Ruang B',exam_id:'e2', scheduled_date: '2026-10-20' }, {pas_period_id:'p1',session_id:'s2',room:'Ruang A',exam_id:'wrong-session', scheduled_date: '2026-10-20' }, {pas_period_id:'p1',session_id:'s1',room:'Ruang B',exam_id:'wrong-room', scheduled_date: '2026-10-20' }],
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
 db.tables.cbt_pas_room_invigilators.push({ user_id: 'teacher', pas_room_id: 'r1', session_id: 's2', exam_date: '2026-10-20' });
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

function roomFixture(failedTables = []) {
 const exams = ['e1', 'e2', 'e3'].map(id => ({ id, organization_id: 'school', created_by: 'admin',
  question_bank_id: 'bank', exam_type: 'pas', is_published: true, end_time: '2026-09-20T02:00:00Z', duration_minutes: 60 }));
 const db = fixtureDb({
  cbt_exams: exams,
  cbt_question_banks: [{ id: 'bank', organization_id: 'school', created_by: 'author' }],
  cbt_pas_periods: [{ id: 'p1', organization_id: 'school' }],
  cbt_pas_rooms: [{ id: 'r1', name: 'Ruang 1', pas_period_id: 'p1' }, { id: 'r2', name: 'Ruang 2', pas_period_id: 'p1' }],
  cbt_pas_room_invigilators: [{ user_id: 'guard', pas_room_id: 'r1', session_id: 's1', exam_date: '2026-10-20' }],
  cbt_pas_room_students: ['u1', 'u2', 'u3', 'u4', 'u5'].map(id => ({ user_id: id, pas_period_id: 'p1', pas_room_id: ['u2', 'u4'].includes(id) ? 'r2' : 'r1' })),
  // Room 1 contains students from X A and X B. X A itself spans two rooms.
  cbt_pas_class_schedules: exams.map((exam, index) => ({ exam_id: exam.id, pas_period_id: 'p1', room: 'Ruang 2', session_id: index === 2 ? 's2' : 's1', scheduled_date: '2026-10-20' })),
  cbt_exam_targets: [{ exam_id: 'e1', class_id: 'xa' }, { exam_id: 'e2', class_id: 'xb' }, { exam_id: 'e3', class_id: 'xa' }],
  cbt_class_members: ['u1', 'u2', 'u3', 'u4', 'u5'].map(id => ({ user_id: id, class_id: ['u3', 'u4'].includes(id) ? 'xb' : 'xa',
   profiles: { full_name: id }, classes: { name: ['u3', 'u4'].includes(id) ? 'X B' : 'X A' } })),
  cbt_exam_attempts: ['u1', 'u2', 'u3', 'u4'].map((id, index) => ({ id: 'a' + (index + 1), user_id: id, exam_id: index < 2 ? 'e1' : 'e2',
   status: 'submitted', total_score: 50, started_at: '2026-09-20T00:00:00Z', finished_at: '2026-09-20T00:20:00Z',
   profiles: { full_name: id }, exams: exams[index < 2 ? 0 : 1], metadata: {} })),
  cbt_exam_question_snapshots: exams.map(exam => ({ exam_id: exam.id, question_snapshot: { id: 'q', type: 'mcq', question_text: 'Soal', bank_question_options: [] } })),
  cbt_answers: ['a1', 'a2', 'a3', 'a4'].map(id => ({ attempt_id: id, question_id: 'q', selected_option_id: 'o', is_correct: true })),
  cbt_attempt_security_logs: ['a1', 'a2', 'a3', 'a4'].map(id => ({ attempt_id: id, event_type: 'tab_switch', created_at: '2026-09-20T00:10:00Z' })),
 }, failedTables, { now: '2026-09-20T00:30:00Z' });
 const roleNames = { guard: ['Pengawas'], teacherGuard: ['Guru'], author: ['Guru', 'Pengawas'], creator: ['Guru'], proctor: ['Proktor'], admin: ['Admin'] };
 const roles = { hasOrgRole: async (id, org, allowed) => org === 'school' && (roleNames[id] || []).some(role => allowed.includes(role)) };
 const auth = new AuthorizationService(db, roles, scope);
 const grading = { retryPendingAutoSubmissions: async () => {}, gradeAttemptFromSavedAnswers: async () => null };
 const scoring = { post: async (_url, payload) => ({ participants: payload.participants, answers: payload.answers }) };
 const service = new ExamMonitoringService(db, auth, scoring, grading, { findById: async () => ({ email: 'student@example.com' }) });
 return { db, auth, roles, service };
}

test('proctors retain monitoring of inactive PAS exams while ordinary foreign drafts stay private', async () => {
 const { db, auth, roles, service } = roomFixture();
 for (const exam of db.tables.cbt_exams) exam.is_published = false;
 db.tables.cbt_exams.push({ id: 'private-draft', organization_id: 'school', created_by: 'teacher', exam_type: 'daily', is_published: false });
 assert.equal(await auth.assertExamMonitoring({ id: 'proctor' }, 'e1'), undefined);
 assert.deepEqual((await service.listAttempts({ id: 'proctor' }, 'e1')).map(row => row.user_id), ['u1', 'u2', 'u5']);
 await assert.rejects(auth.assertExamMonitoring({ id: 'proctor' }, 'private-draft'), /belum dipublikasikan/);
 const admin = new ExamAdminService(db, auth, roles);
 assert.deepEqual((await admin.list({ id: 'proctor' }, 'school')).map(row => row.id), ['e1', 'e2', 'e3']);
 const query = db.queries.filter(query => query.table === 'cbt_exams').find(query => query.calls.some(call => call[0] === 'or'));
 assert.deepEqual(query.calls.find(call => call[0] === 'or'), ['or', 'created_by.eq.proctor,is_published.eq.true,exam_type.in.(pas,pat,pts,pkn,am)']);
});

test('room monitoring discovers exams across class/room boundaries but never another session', async () => {
 const { db, auth } = roomFixture();
 assert.deepEqual(await assignedPasExamIds(db, 'guard', 'school'), ['e1', 'e2']);
 assert.deepEqual(await auth.assertExamMonitoring({ id: 'guard' }, 'e1'), ['u1', 'u3', 'u5']);
 await assert.rejects(auth.assertExamMonitoring({ id: 'guard' }, 'e3'), /izin/);
 db.tables.cbt_pas_room_invigilators[0].user_id = 'teacherGuard';
 assert.deepEqual(await auth.assertExamMonitoring({ id: 'teacherGuard' }, 'e2'), ['u1', 'u3', 'u5']);
});

for (const assessmentType of ['pas', 'pat', 'am']) test(`${assessmentType}: assigned room monitoring does not grant reset permission`, async () => {
 const { db, auth } = roomFixture();
 for (const exam of db.tables.cbt_exams) exam.exam_type = assessmentType;
 assert.deepEqual(await auth.assertExamMonitoring({ id: 'guard' }, 'e1'), ['u1', 'u3', 'u5']);
 await assert.rejects(auth.assertExamMonitoring({ id: 'guard' }, 'e3'), /izin/);
 const exam = db.tables.cbt_exams[0];
 assert.equal(await auth.getExamResetScope({ id: 'proctor' }, exam), null);
 assert.equal(await auth.getExamResetScope({ id: 'guard' }, exam), null);
 assert.equal(await auth.canManageExam({ id: 'teacherGuard' }, { ...exam, created_by: 'teacherGuard' }), false);
});

test('room roster includes only its started and unstarted students, across different classes', async () => {
 const { service } = roomFixture();
 const first = await service.listAttempts({ id: 'guard' }, 'e1');
 assert.deepEqual(first.map(row => row.user_id), ['u1', 'u5']);
 assert.equal(first.find(row => row.user_id === 'u5').status, 'belum');
 assert.deepEqual((await service.listAttempts({ id: 'guard' }, 'e2')).map(row => row.user_id), ['u3']);
});

test('violations, analysis/export and direct attempt details cannot expose other rooms', async () => {
 const { db, service } = roomFixture();
 assert.deepEqual((await service.listRecentViolations({ id: 'guard' }, 'e1', 20)).map(row => row.attemptId), ['a1']);
 const analysis = await service.getItemAnalysis({ id: 'guard' }, 'e1');
 assert.deepEqual(analysis.answers.map(row => row.attempt_id), ['a1']);
 assert.deepEqual(analysis.detailed.participants.map(row => row.user_id), ['u1']);
 await assert.rejects(service.getAttemptDetails({ id: 'guard' }, 'a2'), /ruang dan sesi/);
 assert.equal((await service.getAttemptDetails({ id: 'guard' }, 'a1')).attempt.user_id, 'u1');
 db.tables.cbt_pas_room_invigilators = [];
 await assert.rejects(service.getAttemptDetails({ id: 'guard' }, 'a1'), /izin/);
});

test('bank authors monitor complete target classes across rooms, even with an invigilator role', async () => {
 const { db, auth, service } = roomFixture();
 db.tables.cbt_pas_room_invigilators.push({ user_id: 'author', pas_room_id: 'r1', session_id: 's1', exam_date: '2026-10-20' });
 assert.equal(await auth.assertExamMonitoring({ id: 'author' }, 'e1'), undefined);
 assert.deepEqual((await service.listAttempts({ id: 'author' }, 'e1')).map(row => row.user_id), ['u1', 'u2', 'u5']);
 assert.deepEqual((await service.listAttempts({ id: 'author' }, 'e2')).map(row => row.user_id), ['u3', 'u4']);
 assert.equal((await service.getAttemptDetails({ id: 'author' }, 'a2')).attempt.user_id, 'u2');
 assert.equal(await auth.assertExamMonitoring({ id: 'admin' }, 'e1'), undefined);
});

test('room discovery includes individually assigned and additional-class participants', async () => {
 const { db, service } = roomFixture();
 db.tables.cbt_exam_targets = [{ exam_id: 'e1', additional_class_id: 'extra' }];
 db.tables.cbt_additional_class_members = [{ class_id: 'extra', user_id: 'u1', profiles: { full_name: 'u1' } }];
 db.tables.cbt_exam_participants = [{ exam_id: 'e1', user_id: 'u5' }, { exam_id: 'e1', user_id: 'u2' }];
 db.tables.cbt_profiles = [{ id: 'u5', full_name: 'u5' }, { id: 'u2', full_name: 'u2' }];
 assert.deepEqual(await assignedPasExamIds(db, 'guard', 'school'), ['e1']);
 assert.deepEqual((await service.listAttempts({ id: 'guard' }, 'e1')).map(row => row.user_id), ['u1', 'u5']);
});

test('Pengawas retains existing non-PAS monitoring while PAS without an assignment is denied', async () => {
 const { db, auth } = roomFixture();
 db.tables.cbt_pas_room_invigilators = [];
 await assert.rejects(auth.assertExamMonitoring({ id: 'guard' }, 'e1'), /izin/);
 db.tables.cbt_exams[0].exam_type = 'quiz';
 assert.equal(await auth.assertExamMonitoring({ id: 'guard' }, 'e1'), undefined);
});

test('PAS discovery restricts the Pengawas role while preserving author and admin access', async () => {
 const { db, auth, roles } = roomFixture();
 const service = new ExamAdminService(db, auth, roles);
 assert.deepEqual((await service.list({ id: 'guard' }, 'school')).map(row => row.id), ['e1', 'e2']);
 assert.deepEqual((await service.list({ id: 'author' }, 'school')).map(row => row.id), ['e1', 'e2', 'e3']);
 assert.deepEqual((await service.list({ id: 'admin' }, 'school')).map(row => row.id), ['e1', 'e2', 'e3']);
});

test('empty rooms grant no student visibility, moved students and revoked assignments take effect immediately', async () => {
 const { db, service } = roomFixture();
 db.tables.cbt_pas_class_schedules[0].room = 'Ruang 1';
 db.tables.cbt_pas_room_students = [];
 assert.deepEqual(await service.listAttempts({ id: 'guard' }, 'e1'), []);
 const broken = roomFixture(['cbt_pas_room_students']);
 await assert.rejects(broken.service.listAttempts({ id: 'guard' }, 'e1'), /Penugasan pengawas/);
 const moved = roomFixture();
 moved.db.tables.cbt_pas_room_students.find(row => row.user_id === 'u1').pas_room_id = 'r2';
 assert.deepEqual((await moved.service.listAttempts({ id: 'guard' }, 'e1')).map(row => row.user_id), ['u5']);
 await assert.rejects(moved.service.getAttemptDetails({ id: 'guard' }, 'a1'), /ruang dan sesi/);
});

for (const examType of ['quiz', 'daily', 'assignment', 'pas', 'pat', 'pts', 'pkn']) {
 test(`bank ownership never grants recovery or makeup for ${examType}; exam authorship does`, async () => {
  const { db, auth } = roomFixture();
  db.tables.cbt_exams[0].exam_type = examType;
  const service = new ProctoringService(db, auth, {});
  assert.equal(await auth.canManageExam({ id: 'author' }, db.tables.cbt_exams[0], 'reset'), false);
  await assert.rejects(service.resetAttempt({ id: 'author' }, 'a1', 'Pemulihan peserta', 15), /pembuat ujian/);
  await assert.rejects(service.startMakeupAttempt({ id: 'author' }, 'a1', 'Ujian susulan', 30), /pembuat ujian/);
  assert.equal(db.writes.length, 0);
  db.tables.cbt_exams[0].created_by = 'creator';
  assert.equal(await auth.canManageExam({ id: 'creator' }, db.tables.cbt_exams[0], 'reset'), true);
  await service.resetAttempt({ id: 'creator' }, 'a1', 'Pemulihan peserta', 15);
  assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
  assert.equal(db.tables.cbt_answers.some(row => row.attempt_id === 'a1'), true);
 });
}

for (const assessmentType of ['quiz', 'pas', 'pat', 'am']) test(`${assessmentType}: non-admin staff can recover or start makeup only for their own exams`, async () => {
 for (const id of ['guard', 'creator', 'proctor']) {
  for (const method of ['resetAttempt', 'startMakeupAttempt']) {
   const { db, auth } = roomFixture();
   db.tables.cbt_exams[0].exam_type = assessmentType;
   db.tables.cbt_exams[0].created_by = 'someone-else';
   const service = new ProctoringService(db, auth, {});
   assert.equal(await auth.canManageExam({ id }, db.tables.cbt_exams[0], 'reset'), false);
   await assert.rejects(service[method]({ id }, 'a1', 'Gangguan jaringan', 15), /pembuat ujian/);
   assert.equal(db.writes.length, 0);
   db.tables.cbt_exams[0].created_by = id;
   assert.equal(await auth.canManageExam({ id }, db.tables.cbt_exams[0], 'reset'), true);
   await service[method]({ id }, 'a1', 'Gangguan jaringan', 15);
   assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
   assert.equal(db.tables.cbt_answers.some(row => row.attempt_id === 'a1'), method === 'resetAttempt');
  }
 }
});

for (const examType of ['quiz', 'daily', 'assignment', 'pas', 'pat', 'am', 'pts', 'pkn']) test(`${examType}: admin can reset another creator's participants`, async () => {
 for (const method of ['resetAttempt', 'startMakeupAttempt']) {
  const { db, auth, roles, service: monitoring } = roomFixture();
  db.tables.cbt_exams[0].exam_type = examType;
  db.tables.cbt_exams[0].created_by = 'someone-else';
  const exam = db.tables.cbt_exams[0];
  assert.equal(await auth.canManageExam({ id: 'admin' }, exam, 'reset'), true);
  const exams = new ExamAdminService(db, auth, roles);
  assert.equal((await exams.list({ id: 'admin' }, 'school')).find(row => row.id === exam.id).canResetParticipants, true);
  const rows = await monitoring.listAttempts({ id: 'admin' }, exam.id);
  assert.equal(rows.find(row => row.id === 'a1').canReset, true);
  const recovery = new ProctoringService(db, auth, {});
  await recovery[method]({ id: 'admin' }, 'a1', 'Gangguan jaringan', 15);
  assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
  assert.equal(db.tables.cbt_answers.some(row => row.attempt_id === 'a1'), method === 'resetAttempt');
 }
});

test('a bank author who also supervises PAS retains view access without reset rights', async () => {
 const { db, auth, roles, service } = roomFixture();
 const exams = new ExamAdminService(db, auth, roles);
 assert.equal((await exams.list({ id: 'author' }, 'school'))[0].canResetParticipants, false);
 db.tables.cbt_pas_room_invigilators.push({ user_id: 'author', pas_room_id: 'r1', session_id: 's1', exam_date: '2026-10-20' });
 assert.equal((await exams.list({ id: 'author' }, 'school'))[0].canResetParticipants, false);
 const rows = await service.listAttempts({ id: 'author' }, 'e1');
 assert.deepEqual(rows.map(row => [row.user_id, row.canReset]), [['u1', false], ['u2', false], ['u5', false]]);
 const recovery = new ProctoringService(db, auth, {});
 await assert.rejects(recovery.resetAttempt({ id: 'author' }, 'a1', 'Gangguan jaringan', 15), /pembuat ujian/);
 assert.equal(db.writes.length, 0);
});

test('PAS author monitoring shows actual room and all session invigilators for started and unstarted participants', async () => {
 const { db, service } = roomFixture();
 db.tables.cbt_pas_sessions = [{ id: 's1', pas_period_id: 'p1', name: 'Sesi Pagi' }, { id: 's2', pas_period_id: 'p1', name: 'Sesi Siang' }];
 db.tables.cbt_pas_room_invigilators.push(
  { user_id: 'guard2', pas_room_id: 'r2', session_id: 's1', exam_date: '2026-10-20' },
  { user_id: 'guard3', pas_room_id: 'r2', session_id: 's1', exam_date: '2026-10-20' },
  { user_id: 'afternoon', pas_room_id: 'r1', session_id: 's2', exam_date: '2026-10-20' });
 db.tables.cbt_profiles = [{ id: 'guard', full_name: 'Pengawas Pagi' }, { id: 'guard2', full_name: 'Pengawas Dua' },
  { id: 'guard3', full_name: 'Pengawas Tiga' }, { id: 'afternoon', full_name: 'Pengawas Siang' }];
 const rows = await service.listAttempts({ id: 'author' }, 'e1');
 assert.equal(rows.find(row => row.user_id === 'u1').pas_location.room_name, 'Ruang 1'); // schedule label says Ruang 2
 assert.deepEqual(rows.find(row => row.user_id === 'u1').pas_location.invigilators.map(p => p.full_name), ['Pengawas Pagi']);
 assert.deepEqual(rows.find(row => row.user_id === 'u2').pas_location.invigilators.map(p => p.full_name), ['Pengawas Dua', 'Pengawas Tiga']);
 assert.equal(rows.find(row => row.user_id === 'u5').pas_location.session_name, 'Sesi Pagi');
 assert.equal(rows.find(row => row.user_id === 'u5').pas_location.room_name, 'Ruang 1');
 const detail = await service.getAttemptDetails({ id: 'author' }, 'a2');
 assert.equal(detail.attempt.pas_location.room_name, 'Ruang 2');
 const afternoon = await loadPasParticipantLocations(db, db.tables.cbt_exams[2], ['u1']);
 assert.deepEqual(afternoon.get('u1').invigilators.map(p => p.full_name), ['Pengawas Siang']);
 assert.equal(rows.find(row => row.user_id === 'u1').canReset, false);
});

test('PAS room information never substitutes the schedule label or another period for an unallocated student', async () => {
 const { db } = roomFixture();
 db.tables.cbt_pas_sessions = [{ id: 's1', pas_period_id: 'p1', name: 'Pagi' }];
 db.tables.cbt_pas_room_students = [{ user_id: 'u1', pas_room_id: 'foreign', pas_period_id: 'p2' }];
 db.tables.cbt_pas_rooms.push({ id: 'foreign', pas_period_id: 'p2', name: 'Other school room' });
 const locations = await loadPasParticipantLocations(db, db.tables.cbt_exams[0], ['u1', 'u2']);
 assert.equal(locations.get('u1').status, 'unassigned');
 assert.equal(locations.get('u1').room_name, null);
 assert.deepEqual(locations.get('u1').invigilators, []);
 assert.equal(locations.get('u2').status, 'unassigned');
 db.tables.cbt_pas_room_students = [{ user_id: 'u1', pas_room_id: 'r1', pas_period_id: 'p1' }];
 db.tables.cbt_pas_room_invigilators = [{ user_id: 'guard', pas_room_id: 'r1', session_id: 's2', exam_date: '2026-10-20' }];
 assert.deepEqual((await loadPasParticipantLocations(db, db.tables.cbt_exams[0], ['u1'])).get('u1').invigilators, []);
});

test('missing or failed PAS context reads are explicit and do not make the monitoring roster disappear', async () => {
 const { db } = roomFixture();
 for (const table of ['cbt_pas_class_schedules', 'cbt_pas_periods', 'cbt_pas_sessions', 'cbt_pas_room_students', 'cbt_pas_rooms', 'cbt_pas_room_invigilators', 'cbt_profiles']) {
  const broken = fixtureDb({ ...db.tables, cbt_pas_sessions: [{ id: 's1', pas_period_id: 'p1', name: 'Pagi' }] }, [table]);
  const location = (await loadPasParticipantLocations(broken, db.tables.cbt_exams[0], ['u1'])).get('u1');
  assert.equal(location.status, 'unavailable', table);
  assert.equal(location.room_name, null, table);
 }
 const broken = roomFixture(['cbt_pas_sessions']);
 const rows = await broken.service.listAttempts({ id: 'author' }, 'e1');
 assert.deepEqual(rows.map(row => row.user_id), ['u1', 'u2', 'u5']);
 assert.ok(rows.every(row => row.pas_location.status === 'unavailable'));
 db.tables.cbt_pas_periods[0].organization_id = 'other';
 assert.equal((await loadPasParticipantLocations(db, db.tables.cbt_exams[0], ['u1'])).get('u1').status, 'unavailable');
});

test('large PAS placement reads are batched and normal exams require no placement queries', async () => {
 const ids = Array.from({ length: 620 }, (_, index) => `u${index}`);
 const db = fixtureDb({ cbt_pas_class_schedules: [{ exam_id: 'pas', pas_period_id: 'p', session_id: 's', scheduled_date: '2026-10-20' }],
  cbt_pas_periods: [{ id: 'p', organization_id: 'school' }], cbt_pas_sessions: [{ id: 's', pas_period_id: 'p', name: 'Pagi' }],
  cbt_pas_rooms: [{ id: 'room', name: 'Lab', pas_period_id: 'p' }],
  cbt_pas_room_students: ids.map(user_id => ({ user_id, pas_room_id: 'room', pas_period_id: 'p' })),
  cbt_pas_room_invigilators: [{ pas_room_id: 'room', session_id: 's', user_id: 'guard', exam_date: '2026-10-20' }],
  cbt_profiles: [{ id: 'guard', full_name: 'Pengawas' }] });
 const locations = await loadPasParticipantLocations(db, { id: 'pas', organization_id: 'school', exam_type: 'pas' }, ids);
 assert.equal(locations.size, 620);
 assert.equal(locations.get('u619').room_name, 'Lab');
 assert.equal(db.queries.filter(query => query.table === 'cbt_pas_room_students').length, 3);
 assert.ok(db.queries.length < 15);
 const before = db.queries.length;
 assert.equal((await loadPasParticipantLocations(db, { id: 'quiz', exam_type: 'quiz' }, ids)).size, 0);
 assert.equal(db.queries.length, before);
});

test('pengawas bergilir: penugasan hanya membuka ujian pada tanggal tugasnya', async () => {
 const db = fixture();
 assert.deepEqual(await assignedPasExamIds(db, 'teacher', 'school'), ['e1']);
 db.tables.cbt_pas_room_invigilators[0].exam_date = '2026-10-21';
 assert.deepEqual(await assignedPasExamIds(db, 'teacher', 'school'), []);
 db.tables.cbt_pas_room_invigilators[0].exam_date = new Date('2026-10-20T00:00:00Z');
 assert.deepEqual(await assignedPasExamIds(db, 'teacher', 'school'), ['e1']);
 db.tables.cbt_pas_room_invigilators[0].exam_date = null;
 assert.deepEqual(await assignedPasExamIds(db, 'teacher', 'school'), []);
});

test('lokasi peserta menampilkan pengawas yang bertugas pada tanggal ujian, bukan hari lain', async () => {
 const db = fixtureDb({ cbt_pas_class_schedules: [{ exam_id: 'pas', pas_period_id: 'p', session_id: 's', scheduled_date: '2026-10-20' }],
  cbt_pas_periods: [{ id: 'p', organization_id: 'school' }], cbt_pas_sessions: [{ id: 's', pas_period_id: 'p', name: 'Pagi' }],
  cbt_pas_rooms: [{ id: 'room', name: 'Lab', pas_period_id: 'p' }],
  cbt_pas_room_students: [{ user_id: 'u1', pas_room_id: 'room', pas_period_id: 'p' }],
  cbt_pas_room_invigilators: [{ pas_room_id: 'room', session_id: 's', user_id: 'today', exam_date: '2026-10-20' },
   { pas_room_id: 'room', session_id: 's', user_id: 'tomorrow', exam_date: '2026-10-21' }],
  cbt_profiles: [{ id: 'today', full_name: 'Bu Hari Ini' }, { id: 'tomorrow', full_name: 'Pak Besok' }] });
 const locations = await loadPasParticipantLocations(db, { id: 'pas', organization_id: 'school', exam_type: 'pas' }, ['u1']);
 assert.deepEqual(locations.get('u1').invigilators.map(person => person.full_name), ['Bu Hari Ini']);
});
