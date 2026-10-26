const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { loadPasReadiness } = require('../src/pas/pas-readiness.ts');
const { PasService } = require('../src/pas/pas.service.ts');
function fixture(failed = []) {
 const period = { id: 'p', organization_id: 'school', start_date: '2026-10-01', end_date: '2026-10-11' };
 const schedule = { id: 'sc', pas_period_id: 'p', bank_id: 'b', class_id: 'c', session_id: 's', exam_id: 'e',
  scheduled_date: '2026-10-11', scheduled_time: '07:30', window_end_time: '09:30', duration_minutes: 90, room: 'Lab', status: 'scheduled' };
 const db = fixtureDb({ cbt_pas_periods: [period], cbt_pas_class_schedules: [schedule],
  cbt_question_banks: [{ id: 'b', organization_id: 'school' }], cbt_bank_questions: [{ bank_id: 'b', metadata: {} }],
  cbt_classes: [{ id: 'c', organization_id: 'school' }], cbt_class_members: ['u1', 'u2'].map(user_id => ({ class_id: 'c', user_id })),
  cbt_pas_sessions: [{ id: 's', pas_period_id: 'p', start_time: '07:30', end_time: '09:30' }],
  cbt_pas_rooms: [{ id: 'r1', pas_period_id: 'p', name: 'Lab', capacity: 2 }, { id: 'r2', pas_period_id: 'p', name: 'Ruang 2', capacity: 2 }],
  cbt_pas_room_students: [{ user_id: 'u1', pas_period_id: 'p', pas_room_id: 'r1' }, { user_id: 'u2', pas_period_id: 'p', pas_room_id: 'r2' }],
  cbt_pas_room_invigilators: [{ user_id: 'g1', pas_room_id: 'r1', session_id: 's', exam_date: '2026-10-11' }, { user_id: 'g2', pas_room_id: 'r2', session_id: 's', exam_date: '2026-10-11' }],
  cbt_exams: [{ id: 'e', organization_id: 'school', question_bank_id: 'b', is_published: true, status: 'scheduled' }],
  cbt_exam_targets: [{ exam_id: 'e', class_id: 'c' }],
 }, failed);
 return { db, period: db.tables.cbt_pas_periods[0], schedule: db.tables.cbt_pas_class_schedules[0],
  read: async () => (await loadPasReadiness(db, db.tables.cbt_pas_periods[0], db.tables.cbt_pas_class_schedules)).get('sc') };
}

test('PAS readiness requires complete assignments in every actual room, not just an existing exam', async () => {
 const f = fixture();
 assert.deepEqual(await f.read(), { ready: true, issues: [], activated: true, room_ids: ['r1', 'r2'], room_counts: { r1: 1, r2: 1 }, unassigned_count: 0 });
 f.db.tables.cbt_pas_room_invigilators = [];
 let result = await f.read();
 assert.equal(result.ready, false);
 assert.deepEqual(result.issues, ['Pengawas Lab belum diatur pada tanggal dan sesi ini', 'Pengawas Ruang 2 belum diatur pada tanggal dan sesi ini']);
 f.db.tables.cbt_pas_room_invigilators = [{ user_id: 'g', pas_room_id: 'r1', session_id: 'other', exam_date: '2026-10-11' }];
 assert.equal((await f.read()).ready, false);
 f.db.tables.cbt_pas_room_invigilators = [{ user_id: 'g', pas_room_id: 'r1', session_id: 's', exam_date: '2026-10-11' }];
 result = await f.read(); assert.deepEqual(result.issues, ['Pengawas Ruang 2 belum diatur pada tanggal dan sesi ini']);
});

for (const [name, change, pattern] of [
 ['bank missing', f => { f.schedule.bank_id = null; }, /Bank soal/],
 ['bank empty', f => { f.db.tables.cbt_bank_questions[0].metadata._deleted = true; }, /berisi soal/],
 ['class empty', f => { f.db.tables.cbt_class_members = []; }, /belum memiliki peserta/],
 ['class missing', f => { f.db.tables.cbt_classes = []; }, /Kelas tujuan/],
 ['session missing', f => { f.schedule.session_id = null; }, /Sesi ujian/],
 ['outside period', f => { f.schedule.scheduled_date = '2026-10-12'; }, /di luar periode/],
 ['outside session', f => { f.schedule.window_end_time = '10:00'; }, /tidak sesuai sesi/],
 ['duration too long', f => { f.schedule.duration_minutes = 121; }, /Durasi/],
 ['room not allocated', f => { f.db.tables.cbt_pas_room_students.pop(); }, /1 peserta belum dialokasikan/],
 ['student in two rooms', f => { const first = f.db.tables.cbt_pas_room_students[0]; f.db.tables.cbt_pas_room_students.push({ ...first, pas_room_id: first.pas_room_id === 'r1' ? 'r2' : 'r1' }); }, /1 peserta terdaftar di lebih dari satu ruang/],
 ['room outside period', f => { f.db.tables.cbt_pas_rooms[1].pas_period_id = 'foreign'; }, /belum dialokasikan/],
 ['room over capacity', f => { f.db.tables.cbt_pas_rooms[0].capacity = 1; f.db.tables.cbt_pas_room_students.push({ user_id: 'other-class', pas_period_id: 'p', pas_room_id: 'r1' }); }, /Kapasitas Lab/],
 ['dangling exam', f => { f.schedule.exam_id = 'missing'; }, /terhubung tidak tersedia/],
 ['archived exam', f => { f.db.tables.cbt_exams[0].status = 'archived'; }, /diarsipkan/],
 ['wrong bank on exam', f => { f.db.tables.cbt_exams[0].question_bank_id = 'other'; }, /Bank soal ujian/],
 ['cancelled', f => { f.schedule.status = 'cancelled'; }, /dibatalkan/],
]) test(`PAS readiness rejects ${name}`, async () => {
 const f = fixture(); change(f); const result = await f.read();
 assert.equal(result.ready, false); assert.ok(result.issues.some(issue => pattern.test(issue)), result.issues.join('; '));
});

test('PAS readiness reports how many students of the class sit in each room', async () => {
 const f = fixture();
 const result = await f.read();
 assert.deepEqual(result.room_counts, { r1: 1, r2: 1 });
 assert.equal(result.unassigned_count, 0);
 f.db.tables.cbt_pas_room_students.pop();
 const missing = await f.read();
 assert.equal(missing.unassigned_count, 1);
 assert.equal(Object.values(missing.room_counts).reduce((a, b) => a + b, 0), 1);
});

test('PAS readiness updates after allocation/proctor changes, supports split classes without one room label and SQL TIME dates', async () => {
 const f = fixture(); f.schedule.room = '';
 f.db.tables.cbt_pas_sessions[0].start_time = '1970-01-01T07:30:00.000Z';
 f.db.tables.cbt_pas_sessions[0].end_time = '1970-01-01T09:30:00.000Z';
 assert.equal((await f.read()).ready, true);
 f.db.tables.cbt_pas_room_students.pop(); assert.equal((await f.read()).ready, false);
 f.db.tables.cbt_pas_room_students.push({ user_id: 'u2', pas_period_id: 'p', pas_room_id: 'r1' });
 assert.equal((await f.read()).ready, true);
});

test('PAS readiness cannot become green when a source read fails, including room/proctor reads', async () => {
 for (const table of ['cbt_question_banks', 'cbt_bank_questions', 'cbt_classes', 'cbt_class_members', 'cbt_pas_sessions', 'cbt_pas_rooms', 'cbt_pas_room_students', 'cbt_exams', 'cbt_exam_targets', 'cbt_pas_room_invigilators']) {
  const f = fixture([table]); const result = await f.read();
  assert.equal(result.ready, false, table); assert.match(result.issues[0], /belum dapat diperiksa/, table);
 }
});

test('PAS period returns computed readiness; frontend uses it consistently for rows, room details, count and filters', async () => {
 const f = fixture(); const service = new PasService(f.db, { assertStaffByRecord: async () => {} });
 assert.equal((await service.getPeriod({ id: 'staff' }, 'p')).pas_class_schedules[0].readiness.ready, true);
 f.db.tables.cbt_pas_room_invigilators = [];
 assert.equal((await service.getPeriod({ id: 'staff' }, 'p')).pas_class_schedules[0].readiness.ready, false);
 for (const role of ['admin', 'proktor']) {
  const page = fs.readFileSync(path.resolve(__dirname, `../../web/app/dashboard/${role}/exams/pas/[id]/page.tsx`), 'utf8');
  assert.match(page, /schedules\.filter\(isPASScheduleReady\)/);
  assert.match(page, /statusFilter === 'ready' && !isPASScheduleReady\(sc\)/);
  assert.match(page, /<PASScheduleStatus schedule=\{sc\}/);
  const modal = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/pas/RoomManagementPanel.tsx'), 'utf8');
  assert.match(modal, /<PASScheduleStatus schedule=\{sc\}/);
 }
});

test('readiness label renders missing requirements and never infers ready from exam_id', () => {
 let opened = false;
 const React = { createElement: (type, props, ...children) => ({ type, props, children }), useState: () => [opened, value => { opened = value; }] };
 const mod = { exports: {} };
 const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/PASScheduleStatus.tsx'), 'utf8');
 const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText;
 new Function('require', 'module', 'exports', 'React', code)(name => name === 'react' ? React : new Proxy({}, { get: (_, key) => String(key) }), mod, mod.exports, React);
 const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.children);
 const f = fixture();
 assert.equal(mod.exports.isPASScheduleReady(f.schedule), false);
 let tree = mod.exports.PASScheduleStatus({ schedule: { ...f.schedule, readiness: { ready: false, issues: ['Pengawas Lab belum diatur pada sesi ini'] } } });
 assert.match(text(tree), /Belum lengkap/); assert.doesNotMatch(text(tree), /Pengawas Lab belum diatur/);
 const findButton = node => !node || typeof node !== 'object' ? null : Array.isArray(node) ? node.map(findButton).find(Boolean) : node.type === 'button' ? node : findButton(node.children);
 findButton(tree).props.onClick();
 tree = mod.exports.PASScheduleStatus({ schedule: { ...f.schedule, readiness: { ready: false, issues: ['Pengawas Lab belum diatur pada sesi ini'] } } });
 assert.match(text(tree), /Pengawas Lab belum diatur/);
 opened = false;
 tree = mod.exports.PASScheduleStatus({ schedule: { ...f.schedule, is_activated: false, readiness: { ready: true, issues: [], activated: false } } });
 assert.equal(text(tree), 'NonaktifSiap');
 assert.equal(mod.exports.isPASScheduleReady({ ...f.schedule, readiness: { ready: true, issues: ['Pengawas belum diatur'] } }), false);
});

const { PasSchedulesService } = require('../src/pas/pas-schedules.service.ts');
function activationService(db, auth = {}) {
 return new PasSchedulesService(db, { assertProktorByParent: async () => {}, assertBankAccess: async () => {}, ...auth }, { getSchoolTimeZone: async () => 'Asia/Makassar' });
}

test('a complete schedule is ready before activation; missing supervisors reject direct API activation with no writes', async () => {
 const f = fixture(); f.schedule.exam_id = null; f.db.tables.cbt_exams = []; f.db.tables.cbt_exam_targets = [];
 assert.deepEqual(await f.read(), { ready: true, issues: [], activated: false, room_ids: ['r1', 'r2'], room_counts: { r1: 1, r2: 1 }, unassigned_count: 0 });
 f.db.tables.cbt_pas_room_invigilators = [];
 const before = structuredClone(f.db.tables);
 await assert.rejects(activationService(f.db).setActivation({ id: 'admin' }, 'sc', true), /Pengawas/);
 assert.deepEqual(f.db.tables, before);
});

for (const assessmentType of ['pas', 'pat', 'am']) test(`${assessmentType}: activation, deactivation and reactivation preserve the exam and student answers`, async () => {
 const f = fixture(); f.period.type = assessmentType; f.schedule.exam_id = null; f.db.tables.cbt_exams = []; f.db.tables.cbt_exam_targets = [];
 const service = activationService(f.db);
 await service.setActivation({ id: 'admin' }, 'sc', true);
 const examId = f.db.tables.cbt_pas_class_schedules[0].exam_id;
 assert.equal(f.db.tables.cbt_exams[0].exam_type, assessmentType);
 assert.ok(examId); assert.equal(f.db.tables.cbt_exams[0].is_published, true);
 // Deactivation is refused while someone is still working (staff-finish-stage93); a finished attempt and its answers must survive.
 f.db.tables.cbt_exam_attempts = [{ id: 'a', exam_id: examId, user_id: 'u1', status: 'submitted' }];
 f.db.tables.cbt_answers = [{ attempt_id: 'a', question_id: 'q', selected_option_id: 'o' }];
 await service.setActivation({ id: 'admin' }, 'sc', false);
 assert.equal(f.db.tables.cbt_exams[0].is_published, false);
 assert.equal(f.db.tables.cbt_exam_attempts[0].status, 'submitted');
 assert.equal(f.db.tables.cbt_answers[0].selected_option_id, 'o');
 await service.setActivation({ id: 'admin' }, 'sc', true);
 assert.equal(f.db.tables.cbt_exams.length, 1); assert.equal(f.db.tables.cbt_exams[0].id, examId);
 assert.equal(f.db.tables.cbt_exams[0].is_published, true);
 assert.equal(f.db.tables.cbt_exam_targets.length, 1);
});

test('legacy generation only creates a non-published draft and does not bypass readiness for activation', async () => {
 const f = fixture(); f.schedule.exam_id = null; f.db.tables.cbt_exams = []; f.db.tables.cbt_exam_targets = [];
 f.db.tables.cbt_pas_room_invigilators = [];
 const service = activationService(f.db);
 assert.equal((await service.generate({ id: 'admin' }, ['sc'])).created, 1);
 assert.equal(f.db.tables.cbt_exams[0].is_published, false);
 await assert.rejects(service.setActivation({ id: 'admin' }, 'sc', true), /belum siap/);
});

test('deactivation is allowed for incomplete and locked schedules, activation still rejects locked periods and unauthorized users', async () => {
 const f = fixture(); const service = activationService(f.db);
 f.db.tables.cbt_pas_room_invigilators = [];
 f.period.is_locked = true;
 await service.setActivation({ id: 'admin' }, 'sc', false);
 assert.equal(f.db.tables.cbt_exams[0].is_published, false);
 await assert.rejects(service.setActivation({ id: 'admin' }, 'sc', true), /terkunci/);
 await assert.rejects(activationService(f.db, { assertProktorByParent: async () => { throw new Error('No access'); } }).setActivation({ id: 'teacher' }, 'sc', false), /No access/);
});

test('failed activation transaction leaves exam unpublished and target creation atomic', async () => {
 const f = fixture(); f.schedule.exam_id = null; f.db.tables.cbt_exams = []; f.db.tables.cbt_exam_targets = [];
 const broken = fixtureDb(f.db.tables, [], { failMutation: { table: 'cbt_exam_targets', mutation: 'insert' } });
 await assert.rejects(activationService(broken).setActivation({ id: 'admin' }, 'sc', true));
 assert.equal(broken.tables.cbt_exams.length, 0);
 assert.equal(broken.tables.cbt_pas_class_schedules[0].exam_id, null);
});

test('PAS schedule forms do not auto-generate or auto-activate and expose separate per-row activation actions', () => {
 for (const role of ['admin', 'proktor']) {
  const source = fs.readFileSync(path.resolve(__dirname, `../../web/app/dashboard/${role}/exams/pas/[id]/page.tsx`), 'utf8');
  const add = source.slice(source.indexOf('const handleAddSchedule'), source.indexOf('const handleRemoveSchedule'));
  assert.doesNotMatch(add, /generateExamsFrom|setPASScheduleActivation/);
  assert.match(source, /handleActivation\(\[sc.id\], sc.is_activated !== true\)/);
  assert.match(source, /selectedActiveIds/);
 }
});

test('activation web proxy forwards PUT and student access follows activation status', async () => {
 const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/api/pas/schedules/[scheduleId]/activation/route.ts'), 'utf8');
 const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
 const mod = { exports: {} }; let forwarded;
 new Function('require', 'module', 'exports', code)(name => {
  assert.equal(name, '@/lib/nest-proxy');
  return { proxyJson: async (_request, path, method) => { forwarded = { path, method }; return { ok: true }; } };
 }, mod, mod.exports);
 await mod.exports.PUT({}, { params: Promise.resolve({ scheduleId: 'schedule-id' }) });
 assert.deepEqual(forwarded, { path: '/pas/schedules/schedule-id/activation', method: 'PUT' });
 const { canAccessExam } = require('../src/students/exam-access.ts');
 const audience = { organizationId: 'school', assignedExamIds: new Set(['e']) };
 assert.equal(canAccessExam({ id: 'e', organization_id: 'school', is_published: false }, audience), false);
 assert.equal(canAccessExam({ id: 'e', organization_id: 'school', is_published: true }, audience), true);
});

for (const assessmentType of ['pas', 'pat', 'am']) test(`${assessmentType}: generic publication cannot bypass folder readiness checks`, async () => {
 const { ExamAdminService } = require('../src/proctor/exam-admin.service.ts');
 const f = fixture(); f.db.tables.cbt_exams[0].exam_type = assessmentType; f.db.tables.cbt_exams[0].is_published = false;
 f.db.tables.cbt_exams[0].metadata = { is_pas_exam: true, pas_schedule_id: 'sc' };
 const service = new ExamAdminService(f.db, { assertExamStaff: async () => {} }, {});
 await assert.rejects(service.setPublished({ id: 'admin' }, 'e', true), /kelengkapan ruang dan pengawas/);
 assert.equal(f.db.tables.cbt_exams[0].is_published, false);
});

test('custom room names never require a master-room match and schedule labels cannot override allocations', async () => {
 const f = fixture();
 f.schedule.room = 'Nama ruang bebas';
 f.db.tables.cbt_pas_rooms[0].name = 'Ruang buatan proktor';
 const result = await f.read();
 assert.equal(result.ready, true);
 assert.deepEqual(result.room_ids, ['r1', 'r2']);
 assert.equal(f.db.queries.some(query => query.table === 'master_ruangan'), false);
 f.db.tables.cbt_pas_room_students = [];
 const missing = await f.read();
 assert.equal(missing.ready, false);
 assert.ok(missing.issues.some(issue => /2 peserta belum dialokasikan/.test(issue)));
 assert.ok(missing.issues.every(issue => !/Ruang pada jadwal tidak tersedia/.test(issue)));
});

test('schedule room column shows actual rooms and session supervisors instead of matching a free-text label', () => {
 const React = { createElement: (type, props, ...children) => ({ type, props, children }) };
 const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/PASScheduleRooms.tsx'), 'utf8');
 const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText;
 const mod = { exports: {} };
 new Function('require', 'module', 'exports', 'React', code)(name => {
  assert.equal(name, '@/lib/api/pas');
  return { getRoomSessionInvigilators: (room, session) => (room?.pas_room_invigilators || []).filter(member => member.session_id === session) };
 }, mod, mod.exports, React);
 const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.children);
 const props = { schedule: { session_id: 's', room: 'Label bebas', allocated_room_ids: ['r'] },
  rooms: [{ id: 'r', name: 'Ruang manual', pas_room_invigilators: [
   { user_id: 'g', session_id: 's', profiles: { full_name: 'Bu Sari' } },
   { user_id: 'other', session_id: 's2', profiles: { full_name: 'Pengawas sesi lain' } }] }], onManage: () => {} };
 const rendered = text(mod.exports.PASScheduleRooms(props));
 assert.match(rendered, /Ruang manualBu Sari/);
 assert.doesNotMatch(rendered, /Label bebas|sesi lain|Atur pengawas/);
 props.schedule.allocated_room_ids = [];
 assert.match(text(mod.exports.PASScheduleRooms(props)), /Label bebasAtur penempatan peserta/);
 for (const role of ['admin', 'proktor']) {
  const page = fs.readFileSync(path.resolve(__dirname, `../../web/app/dashboard/${role}/exams/pas/[id]/page.tsx`), 'utf8');
  assert.match(page, /Bank Soal \/ Kelas/);
  assert.doesNotMatch(page, /<th[^>]*>Kelas<\/th>/);
  assert.match(page, /<PASScheduleRooms schedule=\{sc\}/);
 }
});

test('pengawas bergilir: kesiapan memeriksa pengawas pada tanggal jadwal, bukan hari lain', async () => {
 const f = fixture();
 for (const row of f.db.tables.cbt_pas_room_invigilators) row.exam_date = '2026-10-10';
 const result = await f.read();
 assert.equal(result.ready, false);
 assert.deepEqual(result.issues, ['Pengawas Lab belum diatur pada tanggal dan sesi ini', 'Pengawas Ruang 2 belum diatur pada tanggal dan sesi ini']);
 for (const row of f.db.tables.cbt_pas_room_invigilators) row.exam_date = new Date('2026-10-11T00:00:00Z');
 assert.equal((await f.read()).ready, true);
});

test('PAS readiness: kelas tanpa target pada ujian gabungan berarti belum diaktifkan, bukan data rusak', async () => {
 const f = fixture();
 f.db.tables.cbt_exam_targets = [{ exam_id: 'e', class_id: 'kelas-lain' }];
 const result = await f.read();
 assert.equal(result.ready, true, result.issues.join('; '));
 assert.equal(result.activated, false);
 f.db.tables.cbt_exam_targets.push({ exam_id: 'e', class_id: 'c' });
 assert.equal((await f.read()).activated, true);
 f.db.tables.cbt_exams[0].is_published = false;
 assert.equal((await f.read()).activated, false);
});
