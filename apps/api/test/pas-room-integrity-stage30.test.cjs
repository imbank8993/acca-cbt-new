// Run from repository root: node apps/api/test/pas-room-integrity-stage30.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { PasRoomsService } = require('../src/pas/pas-rooms.service.ts');

const user = { id: 'proctor-1', isPlatformAdmin: false };
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
        cbt_pas_periods: [{ id: 'period-1', organization_id: 'school-1' }],
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
            { id: 'inv-1', pas_room_id: 'room-a', user_id: 'watcher-1' },
        ],
    };
}

test('ROOM-01: penggantian pengawas atomik dan ID ganda disimpan sekali', async () => {
    const db = fixtureDb(tables());
    const service = new PasRoomsService(db, authz);

    const result = await service.assignInvigilators(
        user, 'room-a', ['teacher-1', 'teacher-1', 'watcher-1'],
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
        service.assignInvigilators(user, 'room-a', ['teacher-1']),
        /gagal menyimpan pengawas/i,
    );
    assert.deepEqual(
        db.tables.cbt_pas_room_invigilators.map((row) => row.user_id),
        ['watcher-1'],
    );
});

test('ROOM-03: siswa dipindahkan atomik dan peserta yang sudah ada tidak dihitung dua kali', async () => {
    const db = fixtureDb(tables());
    const service = new PasRoomsService(db, authz);

    const result = await service.assignStudents(
        user, 'period-1', 'room-b', ['student-1', 'student-1', 'student-2'],
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
        service.assignStudents(user, 'period-1', 'room-b', ['student-1']),
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
        service.assignStudents(user, 'period-1', 'room-b', ['student-1']),
        /kapasitas ruang tidak cukup/i,
    );
    assert.equal(db.tables.cbt_pas_room_students.some(
        (row) => row.pas_room_id === 'room-a' && row.user_id === 'student-1',
    ), true);
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
        service.assignInvigilators(user, 'room-a', ['student-1']),
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
            path.resolve(__dirname, `../../web/app/dashboard/${role}/pas/RoomManagementModal.tsx`),
            'utf8',
        );
        assert.match(ui, /remainingCapacity/);
        assert.match(ui, /exceedsCapacity/);
        assert.match(ui, /Pilihan melebihi sisa kapasitas/);
        assert.match(ui, /disabled=\{selectedStudentIds\.length === 0 \|\| exceedsCapacity \|\| isSaving\}/);
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
