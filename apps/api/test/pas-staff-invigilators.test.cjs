const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { PasService } = require('../src/pas/pas.service.ts');
const { PasRoomsService } = require('../src/pas/pas-rooms.service.ts');

function fixture() {
    const db = fixtureDb({
        users: [
            { auth_id: 'new-guru', nama_lengkap: 'Adrianah', nip: 'adrianahanna95@gmail.com', role: 'GURU', aktif: true },
            { auth_id: 'new-tu', nama_lengkap: 'Staf Tata Usaha', role: 'TU,PTSP', aktif: true },
            { auth_id: 'inactive', nama_lengkap: 'Guru nonaktif', role: 'GURU', aktif: false },
            { auth_id: 'inactive-member', nama_lengkap: 'Guru akun nonaktif', role: 'GURU', aktif: false },
            { auth_id: 'student', nama_lengkap: 'Siswa aktif', role: 'SISWA', aktif: true },
            { auth_id: 'blocked', nama_lengkap: 'Guru diblokir', role: 'GURU', aktif: true },
        ],
        cbt_organization_members: [
            { id: 'old', organization_id: 'school', user_id: 'old-guru', is_active: true,
                profiles: { full_name: 'Guru lama' }, member_roles: [{ roles: { name: 'Guru' } }] },
            { id: 'blocked-member', organization_id: 'school', user_id: 'blocked', is_active: false,
                profiles: { full_name: 'Guru diblokir' }, member_roles: [{ roles: { name: 'Guru' } }] },
            { id: 'inactive-member-row', organization_id: 'school', user_id: 'inactive-member', is_active: true,
                profiles: { full_name: 'Guru akun nonaktif' }, member_roles: [{ roles: { name: 'Guru' } }] },
        ],
        cbt_pas_periods: [{ id: 'period', organization_id: 'school', start_date: '2026-11-16', end_date: '2026-11-20' }],
        cbt_pas_sessions: [{ id: 'session', pas_period_id: 'period' }],
        cbt_pas_rooms: [{ id: 'room', pas_period_id: 'period', name: 'Ruang 1' }],
        cbt_pas_room_invigilators: [],
    });
    const authz = {
        assertProktor: async () => {},
        assertProktorByParent: async () => {},
    };
    return { db, pas: new PasService(db, authz), rooms: new PasRoomsService(db, authz) };
}

test('pilihan pengawas memuat guru dan tendik ACCA aktif sebelum login CBT', async () => {
    const { pas } = fixture();
    const staff = await pas.listStaff({ id: 'proktor' }, 'school');
    assert.deepEqual(staff.map(person => person.name), ['Adrianah', 'Guru lama', 'Staf Tata Usaha']);
    assert.equal(staff.find(person => person.id === 'new-tu').roles.includes('Tendik'), true);
});

test('tendik baru dapat ditugaskan dan profil serta keanggotaan disiapkan atomik', async () => {
    const { db, rooms } = fixture();
    await rooms.assignInvigilators({ id: 'proktor' }, 'room', ['new-tu'], 'session', '2026-11-17');
    assert.equal(db.tables.cbt_profiles.find(person => person.id === 'new-tu').full_name, 'Staf Tata Usaha');
    assert.equal(db.tables.cbt_organization_members.find(member => member.user_id === 'new-tu').is_active, true);
    assert.deepEqual(db.tables.cbt_pas_room_invigilators.map(row => row.user_id), ['new-tu']);
});

test('akun siswa, nonaktif, dan anggota CBT yang dinonaktifkan tidak dapat ditugaskan', async () => {
    for (const id of ['student', 'inactive', 'inactive-member', 'blocked']) {
        const { db, rooms } = fixture();
        await assert.rejects(rooms.assignInvigilators({ id: 'proktor' }, 'room', [id], 'session', '2026-11-17'));
        assert.equal(db.tables.cbt_pas_room_invigilators.length, 0);
        if (id === 'blocked') assert.equal(db.tables.cbt_organization_members.find(member => member.user_id === id).is_active, false);
    }
});
