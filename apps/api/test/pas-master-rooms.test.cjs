const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { PasRoomsService } = require('../src/pas/pas-rooms.service.ts');

test('master room catalog returns active rooms with string IDs and capacity without modifying master', async () => {
    const db = fixtureDb({ master_ruangan: [
        { id: 12, nama: 'Lab', kode: 'L1', lokasi: 'Lantai 2', kapasitas: 24, aktif: true },
        { id: 13, nama: 'Tutup', aktif: false },
    ] });
    const service = new PasRoomsService(db, { assertOrgStaff: async (_, school) => assert.equal(school, 'school') });
    assert.deepEqual(await service.listMasterRooms({ id: 'staff' }, 'school'), [
        { id: '12', name: 'Lab', code: 'L1', location: 'Lantai 2', capacity: 24 },
    ]);
    assert.equal(db.writes.length, 0);
});

test('master room catalog checks staff scope before reading master', async () => {
    const db = fixtureDb();
    const service = new PasRoomsService(db, { assertOrgStaff: async () => { throw new Error('Forbidden'); } });
    await assert.rejects(service.listMasterRooms({ id: 'student' }, 'school'), /Forbidden/);
    assert.equal(db.queries.length, 0);
});

test('master catalog failure is distinguished from an empty catalog and manual room creation still works', async () => {
    const db = fixtureDb({}, ['master_ruangan']);
    const service = new PasRoomsService(db, { assertOrgStaff: async () => {}, assertProktorByRecord: async () => {} });
    await assert.rejects(service.listMasterRooms({ id: 'staff' }, 'school'), /manual/);
    await service.createRoom({ id: 'staff' }, 'period', { name: 'Ruang tambahan', capacity: 18, clientRequestId: 'request-manual' });
    assert.equal(db.tables.cbt_pas_rooms[0].name, 'Ruang tambahan');
    assert.equal(db.tables.cbt_pas_rooms[0].capacity, 18);
});
