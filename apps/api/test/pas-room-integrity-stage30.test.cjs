// Run from repository root: node apps/api/test/pas-room-integrity-stage30.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { PasRoomsService } = require('../src/pas/pas-rooms.service.ts');

const user = { id: 'proctor-1', isPlatformAdmin: false };
const DAY = '2026-10-20';
const authz = {
    assertProktorByRecord: async () => {},
    assertProktorByParent: async () => {},
};

function member(userId, role, active = true) {
    return {
        id: `member-${userId}`, organization_id: 'school-1', user_id: userId, is_active: active,
        member_roles: [{ roles: { name: role } }],
    };
}

function tables() {
    return {
        cbt_pas_periods: [{ id: 'period-1', organization_id: 'school-1', start_date: '2026-10-19', end_date: '2026-10-23' }],
        cbt_pas_sessions: [{ id: 'session-1', pas_period_id: 'period-1' }, { id: 'session-2', pas_period_id: 'period-1' }, { id: 'session-other', pas_period_id: 'period-2' }],
        cbt_pas_rooms: [
            { id: 'room-a', pas_period_id: 'period-1', name: 'A', capacity: 3 },
            { id: 'room-b', pas_period_id: 'period-1', name: 'B', capacity: 2 },
            { id: 'room-other', pas_period_id: 'period-2', name: 'C', capacity: 10 },
        ],
        cbt_organization_members: [
            member('student-1', 'Siswa'), member('student-2', 'Siswa'),
            member('student-3', 'Siswa'), member('teacher-1', 'Guru'),
            member('watcher-1', 'Pengawas'), member('inactive-student', 'Siswa', false),
        ],
        cbt_pas_room_students: [
            { id: 'placement-1', pas_period_id: 'period-1', pas_room_id: 'room-a', user_id: 'student-1' },
            { id: 'placement-2', pas_period_id: 'period-1', pas_room_id: 'room-b', user_id: 'student-2' },
        ],
        cbt_pas_room_invigilators: [
            { id: 'inv-1', pas_room_id: 'room-a', session_id: 'session-1', exam_date: DAY, user_id: 'watcher-1' },
        ],
    };
}

test('ROOM-01: penggantian pengawas atomik dan ID ganda disimpan sekali', async () => {
    const db = fixtureDb(tables());
    const service = new PasRoomsService(db, authz);

    const result = await service.assignInvigilators(
        user, 'room-a', ['teacher-1', 'teacher-1', 'watcher-1'], 'session-1', DAY,
    );

    assert.equal(result.assigned, 2);
    assert.deepEqual(
        db.tables.cbt_pas_room_invigilators.map((row) => row.user_id).sort(),
        ['teacher-1', 'watcher-1'],
    );
});

test('ROOM-02: kegagalan menyimpan pengawas memulihkan daftar lama', async () => {
    const db = fixtureDb(tables(), [], {
        failMutation: { table: 'cbt_pas_room_invigilators', mutation: 'insert' },
    });
    const service = new PasRoomsService(db, authz);

    await assert.rejects(
        service.assignInvigilators(user, 'room-a', ['teacher-1'], 'session-1', DAY),
        /gagal menyimpan pengawas/i,
    );
    assert.deepEqual(
        db.tables.cbt_pas_room_invigilators.map((row) => row.user_id),
        ['watcher-1'],
    );
});

test('room invigilators are independent for each session, including clearing just one session', async () => {
    const db = fixtureDb(tables());
    const service = new PasRoomsService(db, authz);
    await service.assignInvigilators(user, 'room-a', ['teacher-1'], 'session-1', DAY);
    await service.assignInvigilators(user, 'room-a', ['watcher-1'], 'session-2', DAY);
    assert.deepEqual(db.tables.cbt_pas_room_invigilators.map(row => [row.session_id, row.user_id]),
        [['session-1', 'teacher-1'], ['session-2', 'watcher-1']]);
    await service.assignInvigilators(user, 'room-a', [], 'session-1', DAY);
    assert.deepEqual(db.tables.cbt_pas_room_invigilators.map(row => [row.session_id, row.user_id]), [['session-2', 'watcher-1']]);
    await service.assignInvigilators(user, 'room-a', ['watcher-1'], 'session-1', DAY);
    assert.equal(db.tables.cbt_pas_room_invigilators.filter(row => row.user_id === 'watcher-1').length, 2);
});

test('a missing session or a session from another period cannot alter room invigilators', async () => {
    const db = fixtureDb(tables());
    const service = new PasRoomsService(db, authz);
    const before = structuredClone(db.tables);
    await assert.rejects(service.assignInvigilators(user, 'room-a', ['teacher-1'], '', DAY), /Pilih sesi/);
    await assert.rejects(service.assignInvigilators(user, 'room-a', ['teacher-1'], 'session-other', DAY), /periode ruang yang sama/);
    assert.deepEqual(db.tables, before);
    assert.equal(db.writes.length, 0);
});

test('UI room previews and recaps select only the requested session and date', () => {
    const { getRoomSessionInvigilators } = require('../../web/lib/api/pas.ts');
    const room = { pas_room_invigilators: [
        { user_id: 'alice', session_id: 'morning', exam_date: DAY }, { user_id: 'bob', session_id: 'afternoon', exam_date: DAY },
        { user_id: 'carol', session_id: 'morning', exam_date: '2026-10-21T00:00:00.000Z' },
        { user_id: 'old', session_id: null }, { user_id: 'undated', session_id: 'morning' },
    ] };
    assert.deepEqual(getRoomSessionInvigilators(room, 'morning', DAY).map(i => i.user_id), ['alice']);
    assert.deepEqual(getRoomSessionInvigilators(room, 'morning', '2026-10-21').map(i => i.user_id), ['carol']);
    assert.deepEqual(getRoomSessionInvigilators(room, 'afternoon', DAY).map(i => i.user_id), ['bob']);
    assert.deepEqual(getRoomSessionInvigilators(room, 'evening', DAY), []);
    assert.deepEqual(getRoomSessionInvigilators(room, 'morning'), []);
    assert.deepEqual(getRoomSessionInvigilators(room), []);
});

test('ROOM-03: siswa dipindahkan atomik (move eksplisit) dan peserta yang sudah ada tidak dihitung dua kali', async () => {
    const db = fixtureDb(tables());
    const service = new PasRoomsService(db, authz);

    const result = await service.assignStudents(
        user, 'period-1', 'room-b', ['student-1', 'student-1', 'student-2'], { move: true },
    );

    assert.equal(result.assigned, 2);
    const roomB = db.tables.cbt_pas_room_students.filter((row) => row.pas_room_id === 'room-b');
    assert.deepEqual(roomB.map((row) => row.user_id).sort(), ['student-1', 'student-2']);
    assert.equal(db.tables.cbt_pas_room_students.some(
        (row) => row.pas_room_id === 'room-a' && row.user_id === 'student-1',
    ), false);
});

test('ROOM-04: kegagalan insert siswa mengembalikan penugasan ruang lama', async () => {
    const db = fixtureDb(tables(), [], {
        failMutation: { table: 'cbt_pas_room_students', mutation: 'insert' },
    });
    const service = new PasRoomsService(db, authz);

    await assert.rejects(
        service.assignStudents(user, 'period-1', 'room-b', ['student-1'], { move: true }),
        /gagal menempatkan siswa/i,
    );
    assert.equal(db.tables.cbt_pas_room_students.some(
        (row) => row.pas_room_id === 'room-a' && row.user_id === 'student-1',
    ), true);
    assert.equal(db.tables.cbt_pas_room_students.filter(
        (row) => row.pas_room_id === 'room-b',
    ).length, 1);
});

test('ROOM-05: kapasitas ruang ditegakkan sebelum pemindahan', async () => {
    const data = tables();
    data.cbt_pas_rooms.find((room) => room.id === 'room-b').capacity = 1;
    const db = fixtureDb(data);
    const service = new PasRoomsService(db, authz);

    await assert.rejects(
        service.assignStudents(user, 'period-1', 'room-b', ['student-1'], { move: true }),
        /kapasitas ruang tidak cukup/i,
    );
    assert.equal(db.tables.cbt_pas_room_students.some(
        (row) => row.pas_room_id === 'room-a' && row.user_id === 'student-1',
    ), true);
});

test('ROOM-03b: satu siswa hanya satu ruang — siswa dari ruang lain ditolak tanpa move', async () => {
    const data = tables();
    data.cbt_profiles = [{ id: 'student-1', full_name: 'Ahmad Fauzi' }];
    const db = fixtureDb(data);
    const service = new PasRoomsService(db, authz);

    await assert.rejects(
        service.assignStudents(user, 'period-1', 'room-b', ['student-1', 'student-3']),
        (error) => error.status === 409 && /1 siswa sudah ditempatkan di ruang lain: Ahmad Fauzi \(A\)/.test(error.message)
            && /Satu siswa hanya boleh di satu ruang/.test(error.message),
    );
    // Tidak ada yang berubah, termasuk siswa lain dalam permintaan yang sama.
    assert.deepEqual(db.tables.cbt_pas_room_students.map(row => `${row.user_id}@${row.pas_room_id}`).sort(),
        ['student-1@room-a', 'student-2@room-b']);

    // Siswa baru dan siswa yang sudah di ruang ini tetap diterima.
    const result = await service.assignStudents(user, 'period-1', 'room-a', ['student-1', 'student-3']);
    assert.equal(result.assigned, 2);
    assert.deepEqual(db.tables.cbt_pas_room_students.filter(row => row.pas_room_id === 'room-a').map(row => row.user_id).sort(),
        ['student-1', 'student-3']);
});

test('ROOM-03c: UI tidak bisa mencentang siswa dari ruang lain; pemindahan lewat konfirmasi', () => {
    const ui = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/pas/RoomManagementPanel.tsx'), 'utf8');
    assert.match(ui, /selectableStudents = visibleClassStudents\.filter\(student => !assignedStudentIds\.has\(student\.id\) && !roomElsewhere\(student\.id\)\)/);
    assert.match(ui, /disabled=\{isSaving \|\| alreadyHere \|\| !!otherRoom\}/);
    assert.match(ui, /assignStudentsToRoomAction\(period\.id, selectedRoom\.id, \[studentId\], \{ move: true \}\)/);
    assert.doesNotMatch(ui, /Peserta dari ruang lain akan dipindahkan/);
    const sql = fs.readFileSync(path.resolve(__dirname, '../../../database/migrations/20261025_01_pas_room_student_single_room.sql'), 'utf8');
    assert.match(sql, /UNIQUE INDEX IF NOT EXISTS cbt_pas_room_students_period_user_unique\s+ON public\.cbt_pas_room_students \(pas_period_id, user_id\)/);
});

test('ROOM-03d: daftar peserta ruang memuat NIS dan kelas terjadwal, terurut kelas lalu nama', async () => {
    const data = tables();
    data.cbt_pas_room_students.push({ id: 'placement-3', pas_period_id: 'period-1', pas_room_id: 'room-a', user_id: 'student-3' });
    data.cbt_profiles = [
        { id: 'student-1', full_name: 'Zahra', identity_number: '111' },
        { id: 'student-2', full_name: 'Budi', identity_number: '222' },
        { id: 'student-3', full_name: 'Ahmad', unique_id: '333' },
    ];
    data.cbt_classes = [{ id: 'class-a', name: 'XII A' }, { id: 'class-b', name: 'XII B' }, { id: 'club', name: 'Ekskul Robotik' }];
    data.cbt_class_members = [
        { user_id: 'student-1', class_id: 'class-a', classes: { name: 'XII A' } },
        { user_id: 'student-1', class_id: 'club', classes: { name: 'Ekskul Robotik' } },
        { user_id: 'student-2', class_id: 'class-b', classes: { name: 'XII B' } },
        { user_id: 'student-3', class_id: 'class-a', classes: { name: 'XII A' } },
    ];
    data.cbt_pas_class_schedules = [{ id: 's1', pas_period_id: 'period-1', class_id: 'class-a' }, { id: 's2', pas_period_id: 'period-1', class_id: 'class-b' }];
    const db = fixtureDb(data);
    const service = new PasRoomsService(db, { ...authz, assertStaffByRecord: async () => {} });
    const rooms = await service.listRoomParticipants(user, 'period-1');
    const roomA = rooms.find(room => room.id === 'room-a');
    assert.deepEqual(roomA.students.map(s => [s.full_name, s.nis, s.class_name]), [['Ahmad', '333', 'XII A'], ['Zahra', '111', 'XII A']]);
    assert.deepEqual(rooms.find(room => room.id === 'room-b').students.map(s => [s.full_name, s.nis, s.class_name]), [['Budi', '222', 'XII B']]);
    const profileSelect = db.queries.find(query => query.table === 'cbt_profiles').calls.find(call => call[0] === 'select')[1];
    assert.ok(profileSelect.split(',').every(column => ['id', 'full_name', 'identity_number', 'unique_id'].includes(column.trim())));
    const ui = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/pas/RoomManagementPanel.tsx'), 'utf8');
    assert.match(ui, /Unduh Daftar Peserta/);
    assert.match(ui, /handleDownloadParticipants\(selectedRoom\.id\)/);
    const pdf = fs.readFileSync(path.resolve(__dirname, '../../web/lib/pas/room-participants-pdf.ts'), 'utf8');
    assert.match(pdf, /if \(roomIndex > 0\) pdf\.addPage\(\);\s*const first = pdf\.getNumberOfPages\(\);\s*drawKop\(\);/);
});

test('ROOM-03e: unduhan peserta menolak hasil tidak lengkap bila pembacaan data gagal', async () => {
    for (const table of ['cbt_pas_rooms', 'cbt_pas_room_students', 'cbt_pas_class_schedules', 'cbt_profiles', 'cbt_class_members']) {
        const service = new PasRoomsService(fixtureDb(tables(), [table]), { ...authz, assertStaffByRecord: async () => {} });
        await assert.rejects(service.listRoomParticipants(user, 'period-1'), error => error.getStatus?.() === 503);
    }
});

test('ROOM-06: ruang lintas periode dan pengguna dengan peran salah ditolak', async () => {
    const db = fixtureDb(tables());
    const service = new PasRoomsService(db, authz);

    await assert.rejects(
        service.assignStudents(user, 'period-1', 'room-other', ['student-1']),
        /ruang tidak berada pada periode/i,
    );
    await assert.rejects(
        service.assignStudents(user, 'period-1', 'room-a', ['teacher-1']),
        /peran yang sesuai/i,
    );
    await assert.rejects(
        service.assignInvigilators(user, 'room-a', ['student-1'], 'session-1', DAY),
        /peran yang sesuai/i,
    );
});

test('ROOM-07: mutasi ruang memakai transaksi dan lock sesuai cakupan', () => {
    const rooms = fs.readFileSync(path.resolve(__dirname, '../src/pas/pas-rooms.service.ts'), 'utf8');
    const pas = fs.readFileSync(path.resolve(__dirname, '../src/pas/pas.service.ts'), 'utf8');
    assert.match(rooms, /this\.db\.transaction/g);
    assert.match(rooms, /pas-room-invigilators:/);
    assert.match(rooms, /pas-room-students:/);
    assert.match(rooms, /currentIds\.size \+ movingIds\.length > capacity/);
    assert.match(rooms, /eq\('pas_period_id', periodId\)/);
    assert.match(pas, /\['Guru', 'Pengawas', 'Proktor', 'Admin'\]/);
});

test('ROOM-08: UI admin dan proktor menampilkan serta menegakkan sisa kapasitas', () => {
    for (const role of ['admin', 'proktor']) {
        const ui = fs.readFileSync(
            path.resolve(__dirname, '../../web/app/components/pas/RoomManagementPanel.tsx'),
            'utf8',
        );
        assert.match(ui, /remainingCapacity/);
        assert.match(ui, /exceedsCapacity/);
        assert.match(ui, /Pilihan melebihi sisa kapasitas/);
        assert.match(ui, /Simpan Penempatan/);
        assert.match(ui, /disabled=\{!selectedStudentIds\.length \|\| exceedsCapacity \|\| isSaving \|\| isClassLoading\}/);
        assert.match(ui, /studentIds\.every\(id => savedIds\.has\(id\)\)/);
    }
});

test('ROOM-09: migrasi menjaga kapasitas dan kesamaan periode ruang', () => {
    const sql = fs.readFileSync(
        path.resolve(__dirname, '../../../database/migrations/20260927_05_pas_room_integrity.sql'),
        'utf8',
    );
    assert.match(sql, /cbt_pas_rooms_capacity_positive/);
    assert.match(sql, /ALTER COLUMN capacity SET NOT NULL/);
    assert.match(sql, /cbt_pas_rooms_id_period_unique/);
    assert.match(sql, /cbt_pas_room_students_room_period_fkey/);
    assert.match(sql, /FOREIGN KEY \(pas_room_id, pas_period_id\)/);
});

// ── Pengawas bergilir per hari ───────────────────────────────────────────────
test('ROOM-10: pengawas disimpan per tanggal; mengganti satu hari tidak menyentuh hari lain', async () => {
    const db = fixtureDb(tables());
    const service = new PasRoomsService(db, authz);
    await service.assignInvigilators(user, 'room-a', ['teacher-1'], 'session-1', '2026-10-21');
    const slot = date => db.tables.cbt_pas_room_invigilators
        .filter(row => row.pas_room_id === 'room-a' && row.session_id === 'session-1' && row.exam_date === date)
        .map(row => row.user_id);
    assert.deepEqual(slot(DAY), ['watcher-1']);
    assert.deepEqual(slot('2026-10-21'), ['teacher-1']);
    await service.assignInvigilators(user, 'room-a', [], 'session-1', '2026-10-21');
    assert.deepEqual(slot(DAY), ['watcher-1']);
    assert.deepEqual(slot('2026-10-21'), []);
});

test('ROOM-11: satu orang tidak boleh mengawasi dua ruang pada tanggal & sesi yang sama', async () => {
    const db = fixtureDb(tables());
    const service = new PasRoomsService(db, authz);
    const before = structuredClone(db.tables.cbt_pas_room_invigilators);
    await assert.rejects(service.assignInvigilators(user, 'room-b', ['watcher-1'], 'session-1', DAY), /sudah bertugas di A/);
    assert.deepEqual(db.tables.cbt_pas_room_invigilators, before);
    // Hari lain atau sesi lain boleh.
    await service.assignInvigilators(user, 'room-b', ['watcher-1'], 'session-1', '2026-10-21');
    await service.assignInvigilators(user, 'room-b', ['watcher-1'], 'session-2', DAY);
    // Menyimpan ulang ruang yang sama tidak dianggap bentrok.
    await service.assignInvigilators(user, 'room-a', ['watcher-1', 'teacher-1'], 'session-1', DAY);
});

test('ROOM-12: tanggal tugas harus valid dan berada dalam rentang folder', async () => {
    const db = fixtureDb(tables());
    const service = new PasRoomsService(db, authz);
    await assert.rejects(service.assignInvigilators(user, 'room-a', ['teacher-1'], 'session-1', ''), /YYYY-MM-DD/);
    await assert.rejects(service.assignInvigilators(user, 'room-a', ['teacher-1'], 'session-1', '2026-11-01'), /di antara 2026-10-19 dan 2026-10-23/);
    assert.equal(db.writes.length, 0);
});

test('ROOM-12b: tanggal folder dari basis data (string tengah malam UTC) tetap diterima', async () => {
    // Adapter basis data menyerialkan kolom DATE sebagai "YYYY-MM-DDT00:00:00.000Z".
    const data = tables();
    Object.assign(data.cbt_pas_periods[0], { start_date: '2026-10-19T00:00:00.000Z', end_date: '2026-10-23T00:00:00.000Z' });
    const db = fixtureDb(data);
    const service = new PasRoomsService(db, authz);
    const result = await service.assignInvigilators(user, 'room-b', ['teacher-1'], 'session-1', DAY);
    assert.equal(result.assigned, 1);
    await assert.rejects(service.assignInvigilators(user, 'room-b', ['teacher-1'], 'session-1', '2026-11-01'), /di antara 2026-10-19 dan 2026-10-23/);
    assert.equal((await service.copyInvigilators(user, 'period-1', DAY, '2026-10-21')).copied, 2);
});

test('ROOM-12c: input pengguna tetap ketat; hanya tanggal tersimpan yang memakai storedPasDate', () => {
    const { pasDate, storedPasDate } = require('../src/common/pas-period-policy.ts');
    assert.equal(storedPasDate('2026-10-19T00:00:00.000Z'), '2026-10-19');
    assert.throws(() => pasDate('2026-10-19T00:00:00.000Z'), /YYYY-MM-DD/);
    const rooms = fs.readFileSync(path.resolve(__dirname, '../src/pas/pas-rooms.service.ts'), 'utf8');
    assert.match(rooms, /storedPasDate\(period\.start_date\), end = storedPasDate\(period\.end_date\)/);
    const location = fs.readFileSync(path.resolve(__dirname, '../src/common/pas-participant-location.ts'), 'utf8');
    assert.match(location, /storedPasDate\(contexts\[0\]\.scheduled_date\)/);
});

test('ROOM-13: salin pengawas mengganti seluruh tanggal tujuan dengan susunan tanggal sumber', async () => {
    const db = fixtureDb(tables());
    const service = new PasRoomsService(db, authz);
    await service.assignInvigilators(user, 'room-b', ['teacher-1'], 'session-2', DAY);
    await service.assignInvigilators(user, 'room-a', ['teacher-1'], 'session-1', '2026-10-21');
    const result = await service.copyInvigilators(user, 'period-1', DAY, '2026-10-21');
    assert.equal(result.copied, 2);
    const day = date => db.tables.cbt_pas_room_invigilators.filter(row => row.exam_date === date)
        .map(row => `${row.pas_room_id}:${row.session_id}:${row.user_id}`).sort();
    assert.deepEqual(day('2026-10-21'), day(DAY));
    assert.deepEqual(day(DAY), ['room-a:session-1:watcher-1', 'room-b:session-2:teacher-1']);
    await assert.rejects(service.copyInvigilators(user, 'period-1', DAY, DAY), /tidak boleh sama/);
    await assert.rejects(service.copyInvigilators(user, 'period-1', DAY, '2026-12-01'), /di antara/);
});

test('ROOM-14: salin pengawas dibatalkan seluruhnya bila penyimpanan gagal', async () => {
    const db = fixtureDb(tables(), [], { failMutation: { table: 'cbt_pas_room_invigilators', mutation: 'insert' } });
    const service = new PasRoomsService(db, authz);
    db.tables.cbt_pas_room_invigilators.push({ id: 'inv-2', pas_room_id: 'room-b', session_id: 'session-1', exam_date: '2026-10-21', user_id: 'teacher-1' });
    await assert.rejects(service.copyInvigilators(user, 'period-1', DAY, '2026-10-21'), /Gagal menyalin/);
    assert.deepEqual(db.tables.cbt_pas_room_invigilators.map(row => row.id).sort(), ['inv-1', 'inv-2']);
});

test('ROOM-15: migrasi menambah tanggal tugas dan menyalin penugasan lama ke setiap tanggal folder', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../../database/migrations/20261023_01_pas_invigilator_exam_date.sql'), 'utf8');
    assert.match(sql, /ADD COLUMN IF NOT EXISTS exam_date date/);
    assert.match(sql, /generate_series\(p\.start_date::date, p\.end_date::date/);
    assert.match(sql, /cbt_pas_room_session_date_invigilator_unique/);
    assert.match(sql, /\(pas_room_id, session_id, exam_date, user_id\)/);
    assert.match(sql, /DROP INDEX IF EXISTS public\.cbt_pas_room_session_invigilator_unique/);
});
