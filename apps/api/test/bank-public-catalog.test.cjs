const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { AuthorizationService } = require('../src/auth/authorization.service.ts');
const { QuestionBanksService } = require('../src/questions/question-banks.service.ts');
const { QuestionsService } = require('../src/questions/questions.service.ts');
const { ValidationsService } = require('../src/validations/validations.service.ts');
const { StorageAccessService } = require('../src/storage/storage-access.service.ts');
const { StorageService } = require('../src/storage/storage.service.ts');
const user = { id: 'reader', organizationId: 'school', roles: ['GURU'] };
const image = 'users/owner/questions/image.png';
const denied = error => error.getStatus?.() === 403;

function setup({ proctor = false } = {}) {
    const secret = 'PRIVATE QUESTION AND ANSWER';
    const db = fixtureDb({
        bank_folders: [{ id: 'folder', organization_id: 'school', created_by: 'proctor', is_public: true }],
        cbt_question_banks: [{ id: 'bank', title: 'Physics', organization_id: 'school', created_by: 'owner',
            folder_id: 'folder', is_published: false, description: secret,
            bank_questions: [{ id: 'q', metadata: { explanation: secret } }] }],
        cbt_bank_questions: [{ id: 'q', bank_id: 'bank', type: 'essay',
            question_text: `<img src="/api/storage/file/${image}">${secret}` }],
        cbt_bank_collaborators: [],
        cbt_question_bank_validations: [{ id: 'validation', bank_id: 'bank', organization_id: 'school', status: 'pending' }],
        cbt_question_bank_validators: [],
        cbt_organization_members: ['reader', 'owner', 'proctor'].map(user_id =>
            ({ user_id, organization_id: 'school', is_active: true })),
    });
    const roles = { hasOrgRole: async (id, org, wanted) => org === 'school' &&
        (wanted.includes('Guru') || proctor && id === 'proctor' && wanted.includes('Proktor')) };
    const auth = new AuthorizationService(db, roles, { assertSchoolId: async org => {
        assert.equal(org, 'school'); return org;
    } });
    const banks = new QuestionBanksService(db, auth, roles, { emailMap: async () => new Map() });
    return { db, auth, banks, secret, validations: new ValidationsService(db, auth) };
}

test('Guru C sees only a public bank card and its question count', async () => {
    const { db, auth, banks, validations, secret } = setup();
    const cards = await banks.list(user, 'school', false, true);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].title, 'Physics');
    assert.equal(cards[0].question_count, 1);
    assert.equal(cards[0].canRead, false);
    assert.equal(cards[0].canManage, false);
    assert.equal(cards[0].canDelete, false);
    assert.equal(cards[0].canPublish, false);
    assert.equal(cards[0].validationId, null);
    assert.equal(JSON.stringify(cards).includes(secret), false);
    assert.equal(cards[0].bank_questions, undefined);
    await assert.rejects(banks.get(user, 'bank'), denied);
    await assert.rejects(new QuestionsService(db, auth, {}).listByBank(user, 'bank'), denied);
    await assert.rejects(auth.assertBankAccess(user, 'bank', 'write'), denied);
    await assert.rejects(auth.assertBankAccess(user, 'bank', 'delete'), denied);
    await assert.rejects(banks.setPublished(user, 'bank', true), denied);
    await assert.rejects(validations.getReviewData(user, 'validation'), denied);
});

test('Proktor A who made the folder reads Guru B draft questions without edit or publish rights', async () => {
    const { db, banks, auth } = setup({ proctor: true });
    const proctorUser = { ...user, id: 'proctor', roles: ['PROKTOR'] };
    const cards = await banks.list(proctorUser, 'school', false, true);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].canRead, true);
    assert.equal(cards[0].canManage, false);
    assert.equal(cards[0].canDelete, false);
    assert.equal(cards[0].canPublish, false);
    assert.equal((await banks.get(proctorUser, 'bank')).canManage, false);
    assert.equal((await new QuestionsService(db, auth, {}).listByBank(proctorUser, 'bank'))[0].id, 'q');
    await assert.rejects(auth.assertBankAccess(proctorUser, 'bank', 'write'), denied);
    await assert.rejects(auth.assertBankAccess(proctorUser, 'bank', 'delete'), denied);
    await assert.rejects(banks.setPublished(proctorUser, 'bank', true), denied);
});

test('Guru B still controls publication of the bank they created', async () => {
    const { banks } = setup();
    const creator = { ...user, id: 'owner' };
    assert.equal((await banks.setPublished(creator, 'bank', true)).is_published, true);
    assert.equal((await banks.list(user, 'school', false, true))[0].canRead, false);
    assert.equal((await banks.setPublished(creator, 'bank', false)).is_published, false);
});

test('private folders hide unshared cards; ordinary selectors exclude public drafts', async () => {
    const { db, auth, banks } = setup();
    assert.deepEqual(await banks.list(user, 'school'), []);
    db.tables.cbt_question_banks[0].is_published = true;
    assert.deepEqual(await banks.list(user, 'school', true), []);
    db.tables.bank_folders[0].is_public = false;
    assert.deepEqual(await banks.list(user, 'school', false, true), []);
    await assert.rejects(new QuestionsService(db, auth, {}).listByBank(user, 'bank'), denied);
});

test('teacher can place an owned bank into a proctor’s public folder', async () => {
    const { db, banks } = setup();
    db.tables.cbt_question_banks.push({ id: 'mine', title: 'My bank', organization_id: 'school', created_by: user.id,
        folder_id: null, is_published: false, bank_questions: [] });
    await banks.moveToFolder(user, ['mine'], 'folder');
    assert.equal(db.tables.cbt_question_banks.find(bank => bank.id === 'mine').folder_id, 'folder');
});

test('assigned validator gets a review link for private banks and can review but cannot edit the original', async () => {
    const { db, auth, banks, validations } = setup();
    db.tables.bank_folders[0].is_public = false;
    db.tables.cbt_question_bank_validators.push({ id: 'assignment', validation_id: 'validation', validator_id: user.id });
    const [card] = await banks.list(user, 'school', false, true);
    assert.equal(card.canRead, false);
    assert.equal(card.validationId, 'validation');
    assert.equal(card.canManage, false);
    assert.equal((await validations.getReviewData(user, 'validation')).questions[0].id, 'q');
    await assert.rejects(auth.assertBankAccess(user, 'bank', 'write'), denied);
    const storage = Object.create(StorageService.prototype);
    storage.publicUrl = '/api/storage/file';
    await new StorageAccessService(db, auth, storage).assertRead(user, image);
    db.tables.cbt_question_bank_validators = [];
    assert.deepEqual(await banks.list(user, 'school', false, true), []);
    await assert.rejects(validations.getReviewData(user, 'validation'), denied);
    await assert.rejects(new StorageAccessService(db, auth, storage).assertRead(user, image), denied);
});

test('collaborator keeps normal read access and assignments from another school do not expose cards', async () => {
    const { db, banks } = setup();
    db.tables.cbt_bank_collaborators.push({ bank_id: 'bank', user_id: user.id, permission: 'viewer' });
    assert.equal((await banks.list(user, 'school', false, true))[0].canRead, true);
    db.tables.cbt_bank_collaborators = [];
    db.tables.bank_folders[0].is_public = false;
    db.tables.cbt_question_bank_validators.push({ validation_id: 'validation', validator_id: user.id });
    db.tables.cbt_question_bank_validations[0].organization_id = 'other';
    assert.deepEqual(await banks.list(user, 'school', false, true), []);
});
