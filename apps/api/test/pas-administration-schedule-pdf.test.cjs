const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' } });
require('tsconfig-paths').register({ baseUrl: path.resolve(__dirname, '../../web'), paths: { '@/*': ['./*'] } });

const { buildAdministrationScheduleRows, getAdministrationScheduleMergeRuns } = require('../../web/lib/pas/administration-schedule-pdf.ts');

test('jadwal PDF memuat setiap ruang dan semua pengawas sesuai tanggal, termasuk jadwal yang belum ditempatkan', () => {
    const rooms = [
        { id: 'room-1', name: 'Perpustakaan', pas_room_invigilators: [
            { user_id: 'a', session_id: 'session-1', exam_date: '2026-10-06', profiles: { full_name: 'Pengawas A' } },
            { user_id: 'b', session_id: 'session-1', exam_date: '2026-10-06', profiles: { full_name: 'Pengawas B' } },
            { user_id: 'c', session_id: 'session-1', exam_date: '2026-10-07', profiles: { full_name: 'Pengawas Hari Lain' } },
        ] },
        { id: 'room-2', name: 'Laboratorium', pas_room_invigilators: [] },
    ];
    const sessions = [{ id: 'session-1', name: 'Sesi 1', start_time: '07:30:00', end_time: '09:30:00' }];
    const schedules = [
        { id: 'one', scheduled_date: '2026-10-06', session_id: 'session-1', allocated_room_ids: ['room-1', 'room-2'],
            classes: { name: 'XI IPA' }, subjects: { name: 'Biologi' }, question_banks: { title: 'Paket 1' }, duration_minutes: 90, status: 'active' },
        { id: 'two', scheduled_date: '2026-10-07', session_id: 'session-1', allocated_room_ids: [], room: 'Ruang Cadangan',
            classes: { name: 'XI IPS' }, question_banks: { title: 'Paket 2' }, duration_minutes: 60, status: 'scheduled' },
    ];

    const rows = buildAdministrationScheduleRows(schedules, rooms, sessions);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(row => row.room), ['Laboratorium', 'Perpustakaan', 'Ruang Cadangan']);
    assert.equal(rows[1].invigilators, 'Pengawas A, Pengawas B');
    assert.doesNotMatch(rows[1].invigilators, /Hari Lain/);
    assert.match(rows[1].exam, /Biologi\nPaket 1/);
    assert.equal(rows[2].invigilators, 'Belum ditugaskan');
});

test('jadwal menggabungkan tanggal dan sesi berulang tanpa mencampur sesi atau tanggal lain', () => {
    const rows = [
        { date: '2026-10-06', session: 'Sesi 1', time: '07:30–09:30' },
        { date: '2026-10-06', session: 'Sesi 1', time: '07:30–09:30' },
        { date: '2026-10-06', session: 'Sesi 2', time: '10:00–12:00' },
        { date: '2026-10-07', session: 'Sesi 1', time: '07:30–09:30' },
    ];
    assert.deepEqual(getAdministrationScheduleMergeRuns(rows), {
        dates: [{ start: 0, length: 3 }, { start: 3, length: 1 }],
        sessions: [{ start: 0, length: 2 }, { start: 2, length: 1 }, { start: 3, length: 1 }],
    });
});
