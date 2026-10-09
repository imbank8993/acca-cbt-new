const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ValidationsService } = require('../src/validations/validations.service.ts');
const { AuthorizationService } = require('../src/auth/authorization.service.ts');
const { QuestionBanksService } = require('../src/questions/question-banks.service.ts');
const { ForbiddenException } = require('@nestjs/common');
const user = id => ({ id, organizationId: 'school', roles: [id === 'admin' ? 'ADMIN' : 'GURU'], isPlatformAdmin: false });
function setup(rule = 'any', options = {}) {
    const db = fixtureDb({
        cbt_question_banks: [{ id: 'bank', organization_id: 'school', created_by: 'owner', is_published: false }],
        cbt_question_bank_validations: [{ id: 'session', bank_id: 'bank', organization_id: 'school', approval_rule: rule, status: 'pending' }],
        cbt_question_bank_validators: ['a', 'b'].map(id => ({ id, validation_id: 'session', validator_id: id, status: 'assigned' })),
        cbt_bank_questions: [{ id: 'q1', bank_id: 'bank' }, { id: 'q2', bank_id: 'bank' }, { id: 'foreign', bank_id: 'other' }, { id: 'deleted', bank_id: 'bank', metadata: { _deleted: true } }],
        cbt_bank_question_options: [{ id: 'o1', question_id: 'q1' }, { id: 'o2', question_id: 'q2' }],
        cbt_question_validation_notes: [],
    }, [], options);
    const authz = new AuthorizationService(db, {
        hasOrgRole: async (id, org, roles) => org === 'school' && roles.includes(id === 'admin' ? 'Admin' : 'Guru'),
    }, { assertSchoolId: async id => { if (id !== 'school') throw new ForbiddenException(); return id; } });
    return { db, authz, service: new ValidationsService(db, authz) };
}
const recommendation = generalRecommendation => ({ generalRecommendation });
const note = extra => ({ questionId: 'q1', targetScope: 'question_text', comment: 'Perbaiki teks', ...extra });

test('Unrelated teacher cannot list sessions, read detail or review', async () => {
    const { service } = setup();
    await assert.rejects(service.list(user('stranger')), ForbiddenException);
    await assert.rejects(service.getDetail(user('stranger'), 'session'), ForbiddenException);
    await assert.rejects(service.getReviewData(user('stranger'), 'session'), ForbiddenException);
    assert.equal((await service.list(user('admin'))).length, 1);
});
test('Owner, assigned validators and admin retain detail and review access', async () => {
    const { service } = setup();
    for (const id of ['owner', 'a', 'admin']) {
        assert.equal((await service.getDetail(user(id), 'session')).id, 'session');
        assert.equal((await service.getReviewData(user(id), 'session')).questions.length, 2);
    }
});
for (const [label, payload] of [
    ['another bank', note({ questionId: 'foreign' })],
    ['deleted question', note({ questionId: 'deleted' })],
    ['option from another question', note({ targetScope: 'option', targetOptionId: 'o2' })],
    ['missing option', note({ targetScope: 'option' })],
    ['option on general scope', note({ targetOptionId: 'o1' })],
    ['blank comment', note({ comment: '   ' })],
]) test(`Reject note targeting ${label} without writes`, async () => {
    const { db, service } = setup();
    await assert.rejects(service.saveNote(user('a'), 'session', payload));
    assert.equal(db.tables.cbt_question_validation_notes.length, 0);
    assert.equal(db.tables.cbt_question_bank_validators[0].status, 'assigned');
});
test('Valid option note saves, unassigned teacher cannot save', async () => {
    const { service } = setup();
    const result = await service.saveNote(user('a'), 'session', note({ targetScope: 'option', targetOptionId: 'o1' }));
    assert.equal(result.target_option_id, 'o1');
    await assert.rejects(service.saveNote(user('owner'), 'session', note()), ForbiddenException);
});
for (const recs of [['approved', 'rejected'], ['rejected', 'approved'], ['approved', 'revision_needed'], ['revision_needed', 'approved']]) {
    test(`Any rule stays approved with recommendations ${recs.join(', ')}`, async () => {
        const { db, service } = setup();
        for (let i = 0; i < 2; i++) await service.submitReview(user(['a','b'][i]), 'session', recommendation(recs[i]));
        assert.equal(db.tables.cbt_question_bank_validations[0].status, 'approved');
    });
}
test('Resubmission removes stale approval when no approved recommendation remains', async () => {
    const { db, service } = setup();
    await service.submitReview(user('a'), 'session', recommendation('approved'));
    await service.submitReview(user('a'), 'session', recommendation('rejected'));
    assert.equal(db.tables.cbt_question_bank_validations[0].status, 'in_progress');
});
test('Unanimous rule waits for everyone and respects revision', async () => {
    const { db, service } = setup('unanimous');
    await service.submitReview(user('a'), 'session', recommendation('approved'));
    assert.equal(db.tables.cbt_question_bank_validations[0].status, 'in_progress');
    await service.submitReview(user('b'), 'session', recommendation('revision_needed'));
    assert.equal(db.tables.cbt_question_bank_validations[0].status, 'revision_needed');
    await service.submitReview(user('b'), 'session', recommendation('approved'));
    assert.equal(db.tables.cbt_question_bank_validations[0].status, 'approved');
});
test('Admin decision requires admin, completed recommendations and manual rule', async () => {
    const { db, service } = setup('admin_decides');
    await assert.rejects(service.decide(user('admin'), 'session', 'approved'), /seluruh validator/);
    for (const id of ['a','b']) await service.submitReview(user(id), 'session', recommendation('approved'));
    assert.equal(db.tables.cbt_question_bank_validations[0].status, 'in_progress');
    await assert.rejects(service.decide(user('owner'), 'session', 'approved'), ForbiddenException);
    await service.decide(user('admin'), 'session', 'revision_needed');
    assert.equal(db.tables.cbt_question_bank_validations[0].status, 'revision_needed');
    await service.submitReview(user('a'), 'session', recommendation('approved'));
    assert.equal(db.tables.cbt_question_bank_validations[0].status, 'revision_needed');
    const automatic = setup();
    await assert.rejects(automatic.service.decide(user('admin'), 'session', 'approved'), /otomatis/);
});
test('Status write failure rolls back submitted recommendation', async () => {
    const { db, service } = setup('any', { failMutation: { table: 'cbt_question_bank_validations', mutation: 'update' } });
    await assert.rejects(service.submitReview(user('a'), 'session', recommendation('approved')));
    assert.equal(db.tables.cbt_question_bank_validators[0].status, 'assigned');
});
test('Teacher can still publish own bank for every validation status', async () => {
    const { db, authz } = setup();
    const service = new QuestionBanksService(db, authz);
    for (const status of ['pending', 'in_progress', 'revision_needed', 'rejected', 'approved']) {
        db.tables.cbt_question_bank_validations[0].status = status;
        assert.equal((await service.setPublished(user('owner'), 'bank', true)).is_published, true);
    }
});
