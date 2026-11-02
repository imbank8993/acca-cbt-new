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

function setup() {
    const secret = 'PRIVATE QUESTION AND ANSWER';
    const db = fixtureDb({
        bank_folders: [{ id: 'folder', organization_id: 'school', created_by: 'owner', is_public: true }],
        cbt_question_banks: [{ id: 'bank', title: 'Physics', organization_id: 'school', created_by: 'owner',
            folder_id: 'folder', is_published: false, description: secret,
            bank_questions: [{ id: 'q', metadata: { explanation: secret } }] }],
        cbt_bank_questions: [{ id: 'q', bank_id: 'bank', type: 'essay',
            question_text: `<img src="/api/storage/file/${image}">${secret}` }],
        cbt_bank_collaborators: [],
        cbt_question_bank_validations: [{ id: 'validation', bank_id: 'bank', organization_id: 'school', status: 'pending' }],
        cbt_question_bank_validators: [],
        cbt_organization_members: [{ user_id: user.id, organization_id: 'school', is_active: true }],
    });
    const roles = { hasOrgRole: async (id, org, wanted) => org === 'school' && wanted.includes('Guru') };
    const auth = new AuthorizationService(db, roles, { assertSchoolId: async org => {
        assert.equal(org, 'school'); return org;
    } });
    const banks = new QuestionBanksService(db, auth, roles, { emailMap: async () => new Map() });
    return { db, auth, banks, secret, validations: new ValidationsService(db, auth) };
}

test('public folder shows a locked card without disclosing content or granting direct access', async () => {
    const { db, auth, banks, secret, validations } = setup();
    const cards = await banks.list(user, 'school', false, true);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].title, 'Physics');
    assert.equal(cards[0].canRead, false);
    assert.equal(cards[0].canManage, false);
    assert.equal(cards[0].validationId, null);
    assert.equal(JSON.stringify(cards).includes(secret), false);
    assert.equal(cards[0].bank_questions, undefined);
    await assert.rejects(banks.get(user, 'bank'), denied);
    await assert.rejects(new QuestionsService(db, auth, {}).listByBank(user, 'bank'), denied);
    await assert.rejects(validations.getReviewData(user, 'validation'), denied);
});

test('private folders hide unshared cards; import and exam selectors exclude locked public cards', async () => {
    const { db, banks } = setup();
    assert.deepEqual(await banks.list(user, 'school'), []);
    db.tables.cbt_question_banks[0].is_published = true;
    assert.deepEqual(await banks.list(user, 'school', true), []);
    db.tables.bank_folders[0].is_public = false;
    assert.deepEqual(await banks.list(user, 'school', false, true), []);
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
