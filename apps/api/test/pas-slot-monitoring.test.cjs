// Monitoring ASAS/ASAT/AM per slot (ruang × sesi × tanggal).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { PasMonitoringService } = require('../src/pas/pas-monitoring.service.ts');

const DAY = '2026-10-20', NEXT = '2026-10-21';
function fixture(now = `${DAY}T01:00:00Z`) {
    const db = fixtureDb({
        cbt_pas_periods: [{ id: 'p1', organization_id: 'school', name: 'ASAS Ganjil', type: 'pas' }, { id: 'other', organization_id: 'elsewhere', name: 'X', type: 'pas' }],
        cbt_pas_sessions: [{ id: 's1', pas_period_id: 'p1', name: 'Sesi 1', start_time: '07:30:00', end_time: '09:30:00' },
            { id: 's2', pas_period_id: 'p1', name: 'Sesi 2', start_time: '10:00:00', end_time: '12:00:00' }],
        cbt_pas_rooms: [{ id: 'r1', pas_period_id: 'p1', name: 'Ruang 1', capacity: 4 }, { id: 'r2', pas_period_id: 'p1', name: 'Ruang 2', capacity: 4 }],
        // Ruang 1 berisi siswa kelas X-1 dan XI-2 (kursi tetap selama folder).
        cbt_pas_room_students: [
            { pas_room_id: 'r1', pas_period_id: 'p1', user_id: 'a1' }, { pas_room_id: 'r1', pas_period_id: 'p1', user_id: 'b1' },
            { pas_room_id: 'r2', pas_period_id: 'p1', user_id: 'a2' }, { pas_room_id: 'r2', pas_period_id: 'p1', user_id: 'b2' },
        ],
        cbt_class_members: [{ class_id: 'x1', user_id: 'a1' }, { class_id: 'x1', user_id: 'a2' }, { class_id: 'xi2', user_id: 'b1' }, { class_id: 'xi2', user_id: 'b2' }],
        cbt_classes: [{ id: 'x1', name: 'X-1' }, { id: 'xi2', name: 'XI-2' }],
        cbt_question_banks: [{ id: 'mtk', title: 'Matematika X' }, { id: 'fis', title: 'Fisika XI' }],
        cbt_pas_class_schedules: [
            { id: 'sc1', pas_period_id: 'p1', session_id: 's1', class_id: 'x1', bank_id: 'mtk', exam_id: 'e-mtk', scheduled_date: DAY },
            { id: 'sc2', pas_period_id: 'p1', session_id: 's1', class_id: 'xi2', bank_id: 'fis', exam_id: 'e-fis', scheduled_date: DAY },
            // Bank sama diujikan lagi besok untuk kelas lain → slot lain, ujian lain.
            { id: 'sc3', pas_period_id: 'p1', session_id: 's1', class_id: 'xi2', bank_id: 'mtk', exam_id: 'e-mtk-2', scheduled_date: NEXT },
            { id: 'sc4', pas_period_id: 'p1', session_id: 's2', class_id: 'x1', bank_id: 'fis', exam_id: null, scheduled_date: DAY },
        ],
        cbt_pas_room_invigilators: [
            { pas_room_id: 'r1', session_id: 's1', exam_date: DAY, user_id: 'guard' },
            { pas_room_id: 'r2', session_id: 's1', exam_date: NEXT, user_id: 'guard' },
            { pas_room_id: 'r2', session_id: 's1', exam_date: DAY, user_id: 'other-guard' },
        ],
        cbt_profiles: [{ id: 'guard', full_name: 'Bu Siti' }, { id: 'other-guard', full_name: 'Pak Anwar' }],
        cbt_exam_attempts: [
            { exam_id: 'e-mtk', user_id: 'a1', status: 'in_progress' },
            { exam_id: 'e-fis', user_id: 'b1', status: 'submitted' },
            { exam_id: 'e-fis', user_id: 'b2', status: 'in_progress' },
        ],
    }, [], { now });
    const authz = {
        assertOrgMonitoring: async (_user, org) => { if (org !== 'school') throw new Error('izin'); },
        assertProktor: async user => { if (user.id !== 'proktor') throw new Error('Forbidden'); },
    };
    return { db, service: new PasMonitoringService(db, authz) };
}
const proktor = { id: 'proktor' }, guard = { id: 'guard' };

test('slot menggabungkan beberapa kelas & bank soal yang duduk di satu ruang', async () => {
    const { service } = fixture();
    const result = await service.listSlots(proktor, 'school', DAY);
    assert.equal(result.is_manager, true);
    assert.deepEqual(result.available_dates, [DAY, NEXT]);
    assert.deepEqual(result.slots.map(slot => slot.key), [`p1:r1:s1:${DAY}`, `p1:r2:s1:${DAY}`]);
    const room1 = result.slots[0];
    assert.deepEqual(room1.exams.map(exam => `${exam.class_name}:${exam.bank_title}:${exam.student_count}`), ['X-1:Matematika X:1', 'XI-2:Fisika XI:1']);
    assert.deepEqual(room1.student_ids, ['a1', 'b1']);
    assert.deepEqual(room1.counts, { total: 2, in_progress: 1, finished: 1, not_started: 0 });
    assert.deepEqual(room1.invigilators, [{ user_id: 'guard', full_name: 'Bu Siti' }]);
    assert.deepEqual(result.slots[1].counts, { total: 2, in_progress: 1, finished: 0, not_started: 1 });
    // Jadwal tanpa ujian aktif (exam_id kosong) tidak membuat slot.
    assert.equal(result.slots.some(slot => slot.session.id === 's2'), false);
});

test('bank yang sama di hari lain menjadi slot dan ujian terpisah', async () => {
    const { service } = fixture();
    const result = await service.listSlots(proktor, 'school', NEXT);
    assert.deepEqual(result.slots.map(slot => [slot.room.name, slot.exams.map(exam => exam.exam_id)]), [['Ruang 1', ['e-mtk-2']], ['Ruang 2', ['e-mtk-2']]]);
    assert.deepEqual(result.slots.map(slot => slot.counts.not_started), [1, 1]);
});

test('pengawas hanya melihat slot tugasnya pada tanggal itu', async () => {
    const { service } = fixture();
    const today = await service.listSlots(guard, 'school', DAY);
    assert.equal(today.is_manager, false);
    assert.deepEqual(today.available_dates, [DAY], 'pengawas hanya dapat memilih hari tugas yang sedang berjalan');
    assert.deepEqual(today.slots.map(slot => [slot.room.name, slot.is_mine]), [['Ruang 1', true]]);
    // Tugas besok belum dapat dipantau hari ini.
    const early = await service.listSlots(guard, 'school', NEXT);
    assert.deepEqual(early.slots, []);
    // Pada harinya, tugas besok terbuka dan tugas kemarin tertutup.
    const nextDay = fixture(`${NEXT}T01:00:00Z`).service;
    assert.deepEqual((await nextDay.listSlots(guard, 'school', NEXT)).slots.map(slot => slot.room.name), ['Ruang 2']);
    assert.deepEqual((await nextDay.listSlots(guard, 'school', DAY)).slots, []);
    assert.deepEqual((await nextDay.listSlots(guard, 'school', undefined)).available_dates, [NEXT]);
    const stranger = await service.listSlots({ id: 'nobody' }, 'school', DAY);
    assert.deepEqual(stranger, { date: DAY, is_manager: false, available_dates: [], slots: [] });
});

test('tanpa tanggal hanya mengembalikan pilihan tanggal; tanggal tidak valid ditolak; sekolah lain ditolak', async () => {
    const { service } = fixture();
    assert.deepEqual(await service.listSlots(proktor, 'school', undefined), { date: '', is_manager: true, available_dates: [DAY, NEXT], slots: [] });
    await assert.rejects(service.listSlots(proktor, 'school', '20-10-2026'), /YYYY-MM-DD/);
    await assert.rejects(service.listSlots(proktor, 'elsewhere', DAY), /izin/);
    const scoped = await service.listSlots(proktor, 'school', DAY, 'other');
    assert.deepEqual(scoped.slots, []);
});

function loadSlotHelpers() {
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/monitoring/PASSlotMonitoring.tsx'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', code)(name => name === 'react'
        ? { useState: () => [], useEffect() {}, useMemo: fn => fn(), useCallback: fn => fn, useRef: value => ({ current: value }) }
        : new Proxy({}, { get: (_, key) => key }), mod, mod.exports);
    return mod.exports;
}

test('pilihan tanggal & slot awal: hari ini, lalu berikutnya; sesi yang sedang berjalan untuk pengawas', () => {
    const { pickSlotDate, pickCurrentSlot } = loadSlotHelpers();
    assert.equal(pickSlotDate([DAY, NEXT], DAY), DAY);
    assert.equal(pickSlotDate([DAY, NEXT], '2026-10-19'), DAY);
    assert.equal(pickSlotDate([DAY, NEXT], '2026-10-30'), NEXT);
    assert.equal(pickSlotDate([], DAY), '');
    const slot = (key, start, end, mine = true) => ({ key, is_mine: mine, session: { start_time: start, end_time: end } });
    const slots = [slot('pagi', '07:30:00', '09:30:00'), slot('siang', '10:00:00', '12:00:00'), slot('lain', '07:30:00', '09:30:00', false)];
    assert.equal(pickCurrentSlot(slots, '08:15').key, 'pagi');
    assert.equal(pickCurrentSlot(slots, '09:45').key, 'siang');
    assert.equal(pickCurrentSlot(slots, '13:00').key, 'pagi');
    assert.equal(pickCurrentSlot([], '08:00'), null);
});

test('peserta ruang: gabungan beberapa ujian, hanya siswa yang duduk di ruang itu', () => {
    const { slotAttempts } = loadSlotHelpers();
    const slot = { room: { id: 'r1' }, student_ids: ['a1', 'b1', 'c1'], exams: [{ exam_id: 'e1' }, { exam_id: 'e2' }] };
    const rows = slotAttempts(slot, {
        e1: [{ id: 'x', exam_id: 'e1', user_id: 'a1', pas_location: { room_id: 'r1' } },
            { id: 'y', exam_id: 'e1', user_id: 'a2', pas_location: { room_id: 'r2' } }],
        e2: [{ id: 'z', exam_id: 'e2', user_id: 'b1', pas_location: { room_id: 'r1' } },
            { id: 'unstarted-c1', exam_id: 'e2', user_id: 'c1', pas_location: null },
            { id: 'w', exam_id: 'e2', user_id: 'd1', pas_location: null }],
    });
    assert.deepEqual(rows.map(row => row.id), ['x', 'z', 'unstarted-c1']);
});
