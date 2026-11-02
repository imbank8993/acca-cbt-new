const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { validate } = require('class-validator');
const { fixtureDb } = require('./fixture-db.cjs');
const { AuthorizationService } = require('../src/auth/authorization.service.ts');
const { ValidationsService } = require('../src/validations/validations.service.ts');
const { CreateValidationDto, UpdateValidationDto, SaveValidationFolderDto } = require('../src/validations/dto/validations.dto.ts');
const user = id => ({ id, organizationId: 'school' });
function setup(failedTables = []) {
    const session = { id: 'session', organization_id: 'school', bank_id: 'bank', created_by: 'proctor', folder_id: null, status: 'approved', round: 2, bank: { created_by: 'owner', is_published: true } };
    const db = fixtureDb({
        cbt_validation_folders: [
            { id: 'folder', organization_id: 'school', created_by: 'proctor', name: 'ASAS 2026' },
            { id: 'foreign', organization_id: 'other', created_by: 'admin', name: 'Sekolah Lain' },
        ],
        cbt_question_banks: [{ id: 'bank', organization_id: 'school', created_by: 'owner', title: 'Matematika', is_published: true }],
        cbt_question_bank_validations: [session],
        cbt_question_bank_validators: [{ id: 'assignment', validation_id: 'session', validator_id: 'teacher', status: 'submitted', validation: session }],
        cbt_question_validation_notes: [{ id: 'note', validation_id: 'session', comment: 'Catatan lama', is_resolved: true }],
    }, failedTables);
    const roles = { hasOrgRole: async (id, org, wanted) => org === 'school' && wanted.includes(id === 'admin' ? 'Admin' : id.startsWith('proctor') ? 'Proktor' : 'Guru') };
    const auth = new AuthorizationService(db, roles, { assertSchoolId: async id => { if (id !== 'school') throw Error('Sekolah lain'); return id; } });
    return { db, service: new ValidationsService(db, auth) };
}

test('Admin and Proktor create named school folders; teachers cannot manage folders', async () => {
    const { db, service } = setup();
    const added = await service.createFolder(user('proctor'), '  ASAS 2027  ');
    assert.equal(db.tables.cbt_validation_folders.find(folder => folder.id === added.id).name, 'ASAS 2027');
    assert.equal((await service.listFolders(user('admin'))).length, 2);
    for (const action of [() => service.listFolders(user('teacher')), () => service.createFolder(user('teacher'), 'X'),
        () => service.updateFolder(user('teacher'), 'folder', 'X'), () => service.removeFolder(user('teacher'), 'folder')]) {
        await assert.rejects(action, error => error.getStatus?.() === 403);
    }
    for (const name of ['   ', 'x'.repeat(121)]) await assert.rejects(service.createFolder(user('admin'), name));
});

test('only folder creator or Admin may rename/delete; other schools are inaccessible', async () => {
    const { service } = setup();
    assert.equal((await service.listFolders(user('proctor2')))[0].canManage, false);
    for (const action of [() => service.updateFolder(user('proctor2'), 'folder', 'X'), () => service.removeFolder(user('proctor2'), 'folder')]) {
        await assert.rejects(action, error => error.getStatus?.() === 403);
    }
    await service.updateFolder(user('admin'), 'folder', 'ASAS 2026/2027');
    assert.equal((await service.listFolders(user('proctor')))[0].name, 'ASAS 2026/2027');
    await assert.rejects(service.removeFolder(user('admin'), 'foreign'), error => error.getStatus?.() === 404);
});

test('moving existing validations into/out of folders preserves review history and never touches banks', async () => {
    const { db, service } = setup();
    const notes = structuredClone(db.tables.cbt_question_validation_notes);
    await service.updateSession(user('proctor'), 'session', { folderId: 'folder' });
    const moved = db.tables.cbt_question_bank_validations[0];
    assert.equal(moved.folder_id, 'folder');
    assert.equal(moved.status, 'approved');
    assert.equal(moved.round, 2);
    assert.deepEqual(db.tables.cbt_question_validation_notes, notes);
    assert.equal((await service.list(user('proctor')))[0].folder.name, 'ASAS 2026');
    assert.equal((await service.listFolders(user('proctor')))[0].canDelete, false);
    await assert.rejects(service.removeFolder(user('admin'), 'folder'), /masih berisi sesi validasi/);
    await service.updateSession(user('admin'), 'session', { folderId: null });
    assert.equal((await service.listFolders(user('proctor')))[0].canDelete, true);
    await service.removeFolder(user('proctor'), 'folder');
    assert.equal(db.tables.cbt_question_bank_validations.length, 1);
    assert.equal(db.tables.cbt_question_bank_validations[0].folder_id, null);
    assert.equal(db.writes.some(write => write.table === 'cbt_question_banks'), false);
});

test('create accepts a selected folder and rejects foreign/missing folders before inserting a session', async () => {
    const { db, service } = setup();
    for (const folderId of ['foreign', 'missing']) {
        await assert.rejects(service.create(user('proctor'), { bankId: 'bank', validatorIds: ['teacher'], folderId }), /tujuan tidak ditemukan/);
    }
    const result = await service.create(user('proctor'), { bankId: 'bank', validatorIds: ['teacher'], folderId: 'folder' });
    assert.equal(db.tables.cbt_question_bank_validations.find(row => row.id === result.id).folder_id, 'folder');
    assert.equal(db.tables.cbt_question_bank_validations.length, 2);
});

test('moving into another school folder or moving as an unrelated teacher makes no writes', async () => {
    const { db, service } = setup();
    await assert.rejects(service.updateSession(user('admin'), 'session', { folderId: 'foreign' }), /tujuan tidak ditemukan/);
    await assert.rejects(service.updateSession(user('teacher'), 'session', { folderId: 'folder' }), error => error.getStatus?.() === 403);
    assert.equal(db.writes.length, 0);
});

test('teachers receive folder names only through their assigned tasks, without broadening task access', async () => {
    const { db, service } = setup();
    db.tables.cbt_question_bank_validators[0].validation.folder_id = 'folder';
    db.tables.cbt_question_bank_validators.push({ id: 'other-task', validator_id: 'other', validation: { organization_id: 'school', folder_id: 'folder' } });
    const tasks = await service.listMyAssignedTasks(user('teacher'));
    assert.equal(tasks.length, 1);
    assert.deepEqual(tasks[0].validation.folder, { id: 'folder', name: 'ASAS 2026' });
    assert.equal((await service.listMyAssignedTasks(user('stranger'))).length, 0);
});

test('unreadable contents prevent folder deletion and unpublished banks remain restricted for proctors', async () => {
    const failed = setup(['cbt_question_bank_validations']);
    await assert.rejects(failed.service.removeFolder(user('admin'), 'folder'), /belum dapat diperiksa/);
    assert.equal(failed.db.writes.length, 0);
    const { db, service } = setup();
    db.tables.cbt_question_banks[0].is_published = false;
    await assert.rejects(service.updateSession(user('proctor'), 'session', { folderId: 'folder' }), error => error.getStatus?.() === 403);
    assert.equal(db.writes.length, 0);
});

test('folder DTOs validate names and nullable UUID destinations', async () => {
    for (const Type of [CreateValidationDto, UpdateValidationDto]) {
        const dto = Object.assign(new Type(), { folderId: 'not-a-uuid' });
        assert.ok((await validate(dto)).some(error => error.property === 'folderId'));
        dto.folderId = null;
        assert.equal((await validate(dto)).some(error => error.property === 'folderId'), false);
    }
    assert.ok((await validate(Object.assign(new SaveValidationFolderDto(), { name: 'x'.repeat(121) }))).length);
});
