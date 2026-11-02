const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { AuthorizationService } = require('../src/auth/authorization.service.ts');
const { QuestionBanksService } = require('../src/questions/question-banks.service.ts');

function fixture(failedTables = []) {
    const db = fixtureDb({
        bank_folders: [{ id: 'folder', organization_id: 'school', created_by: 'proctor', is_public: true }],
        // This private bank is hidden from the folder's proctor owner.
        cbt_question_banks: [{ id: 'draft', organization_id: 'school', created_by: 'teacher', is_published: false, folder_id: 'folder' }],
    }, failedTables);
    const roles = { hasOrgRole: async (id, org, allowed) => org === 'school' && allowed.includes(id === 'admin' ? 'Admin' : id === 'proctor' ? 'Proktor' : 'Guru') };
    const auth = new AuthorizationService(db, roles, { assertSchoolId: async id => id });
    return { db, service: new QuestionBanksService(db, auth, roles, { emailMap: async () => new Map() }) };
}

test('hidden banks block folder deletion for both its owner and Admin without moving or deleting contents', async () => {
    const { db, service } = fixture();
    for (const id of ['proctor', 'admin']) {
        assert.equal((await service.listFolders({ id }, 'school'))[0].canDelete, false);
        await assert.rejects(service.removeFolder({ id }, 'folder'), /Folder masih berisi bank soal/);
    }
    assert.equal(db.writes.length, 0);
    assert.equal(db.tables.bank_folders.length, 1);
    assert.equal(db.tables.cbt_question_banks[0].folder_id, 'folder');
    // A public folder does not grant other teachers deletion rights.
    await assert.rejects(service.removeFolder({ id: 'teacher' }, 'folder'), error => error.getStatus?.() === 403);
});

test('moving the last bank out permits empty folder deletion by its owner or Admin', async () => {
    for (const id of ['proctor', 'admin']) {
        const { db, service } = fixture();
        await service.moveToFolder({ id: 'teacher' }, ['draft'], null);
        assert.equal((await service.listFolders({ id }, 'school'))[0].canDelete, true);
        await service.removeFolder({ id }, 'folder');
        assert.equal(db.tables.bank_folders.length, 0);
        assert.equal(db.tables.cbt_question_banks.length, 1);
        assert.equal(db.tables.cbt_question_banks[0].folder_id, null);
    }
});

test('folder contents read failures prevent deletion and do not advertise delete permission', async () => {
    const { db, service } = fixture(['cbt_question_banks']);
    await assert.rejects(service.listFolders({ id: 'admin' }, 'school'), /Isi folder belum dapat diperiksa/);
    await assert.rejects(service.removeFolder({ id: 'admin' }, 'folder'), /Isi folder belum dapat diperiksa/);
    assert.equal(db.writes.length, 0);
    assert.equal(db.tables.bank_folders.length, 1);
});

test('folder contents are checked after acquiring the transaction lock', async () => {
    const { db, service } = fixture();
    db.tables.cbt_question_banks = [];
    db.raw = async sql => {
        assert.match(sql, /bank_folders.*FOR UPDATE/);
        // A bank that arrived while deletion waited for the folder lock must be observed.
        db.tables.cbt_question_banks.push({ id: 'arrived', folder_id: 'folder' });
        return [{ id: 'folder' }];
    };
    await assert.rejects(service.removeFolder({ id: 'admin' }, 'folder'), /Folder masih berisi bank soal/);
    assert.equal(db.writes.length, 0);
    assert.equal(db.tables.bank_folders.length, 1);
});
