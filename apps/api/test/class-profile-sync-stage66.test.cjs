// Run from repository root: node apps/api/test/class-profile-sync-stage66.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node').register({
    project: path.resolve(__dirname, '../tsconfig.json'),
    transpileOnly: true,
});

const { fixtureDb } = require('./fixture-db.cjs');
const { ClassesService } = require('../src/proctor/classes.service.ts');

function createService(initial, options = {}) {
    const db = fixtureDb(initial, [], options);
    return { db, service: new ClassesService(db, {}, {}) };
}

test('CLASS-PROFILE-01: sinkronisasi kelas tidak menimpa identitas profil lama', async () => {
    const { db, service } = createService({
        siswa_kelas: [
            {
                aktif: true,
                tahun_ajaran: '2026/2027',
                kelas: 'X-A',
                nisn: '1001',
                nama_siswa: 'Nama Baru dari Master',
            },
            {
                aktif: true,
                tahun_ajaran: '2026/2027',
                kelas: 'X-A',
                nisn: '1002',
                nama_siswa: 'Siswa Baru',
            },
        ],
        users: [
            { auth_id: 'user-1', nip: '1001', nama: 'Nama Lama' },
            { auth_id: 'user-2', nip: '1002', nama: 'Siswa Baru' },
        ],
        cbt_profiles: [
            { id: 'user-1', full_name: 'Nama Profil Terkunci', identity_number: '1001' },
        ],
        cbt_class_members: [],
    });

    await service.syncMembers(
        new Map([['X-A-2026/2027', 'class-1']]),
        ['2026/2027'],
    );

    assert.deepEqual(
        db.tables.cbt_profiles.find((profile) => profile.id === 'user-1'),
        { id: 'user-1', full_name: 'Nama Profil Terkunci', identity_number: '1001' },
    );
    assert.equal(db.tables.cbt_profiles.find((profile) => profile.id === 'user-2').full_name, 'Siswa Baru');
    assert.deepEqual(
        db.tables.cbt_class_members.map(({ class_id, user_id }) => ({ class_id, user_id })),
        [
            { class_id: 'class-1', user_id: 'user-1' },
            { class_id: 'class-1', user_id: 'user-2' },
        ],
    );

    const memberWrite = db.writes.find((write) => write.table === 'cbt_class_members');
    assert.equal(memberWrite.mutation, 'upsert');
    assert.deepEqual(
        memberWrite.calls.find(([method]) => method === 'upsert')[2],
        { onConflict: 'class_id,user_id', ignoreDuplicates: true },
    );

    const profileWrite = db.writes.find((write) => write.table === 'cbt_profiles');
    assert.equal(profileWrite.mutation, 'upsert');
    assert.deepEqual(profileWrite.payload.map((profile) => profile.id), ['user-2']);
    assert.deepEqual(
        profileWrite.calls.find(([method]) => method === 'upsert')[2],
        { onConflict: 'id', ignoreDuplicates: true },
    );
});

test('CLASS-PROFILE-02: anggota kelas tidak ditulis jika profil baru gagal dibuat', async () => {
    const { db, service } = createService({
        siswa_kelas: [{
            aktif: true,
            tahun_ajaran: '2026/2027',
            kelas: 'X-A',
            nisn: '1002',
            nama_siswa: 'Siswa Baru',
        }],
        users: [{ auth_id: 'user-2', nip: '1002', nama: 'Siswa Baru' }],
        cbt_profiles: [],
        cbt_class_members: [],
    }, { failMutation: { table: 'cbt_profiles', mutation: 'upsert' } });

    await assert.rejects(
        service.syncMembers(new Map([['X-A-2026/2027', 'class-1']]), ['2026/2027']),
        /Gagal membuat profil siswa: synthetic mutation failure/,
    );

    assert.equal(db.tables.cbt_class_members.length, 0);
    assert.equal(db.writes.some((write) => write.table === 'cbt_class_members'), false);
});
