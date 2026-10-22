const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ValidationsService } = require('../src/validations/validations.service.ts');
const { AuthorizationService } = require('../src/auth/authorization.service.ts');
const { QuestionBanksService } = require('../src/questions/question-banks.service.ts');
const { QuestionsService } = require('../src/questions/questions.service.ts');
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

test('validation numbering matches bank creation order, including imported positions and identical timestamps', async () => {
    const { db, service, authz } = setup();
    const question = (id, created, metadata = {}) => ({ id, bank_id: 'bank', created_at: created,
        updated_at: '2026-10-15T00:00:00Z', metadata });
    db.tables.cbt_bank_questions = [
        question('third', '2026-10-01T08:00:00Z', { order_index: 2 }),
        question('legacy-b', '2026-10-01T10:00:00Z'),
        question('second', '2026-10-01T08:00:00Z', { order_index: 1 }),
        question('first', '2026-10-02T08:00:00Z', { order_index: 0 }),
        question('legacy-a', '2026-10-01T10:00:00Z'),
        question('legacy-oldest', '2026-09-30T08:00:00Z'),
        question('deleted', '2026-09-29T00:00:00Z', { _deleted: true, order_index: -1 }),
        { ...question('foreign', '2026-09-29T00:00:00Z'), bank_id: 'other' },
    ];
    const expected = ['first', 'second', 'third', 'legacy-oldest', 'legacy-a', 'legacy-b'];
    const bank = new QuestionsService(db, authz, {});
    assert.deepEqual((await bank.listByBank(user('owner'), 'bank')).map(q => q.id), expected);
    const review = await service.getReviewData(user('a'), 'session');
    assert.deepEqual(review.questions.map(q => q.id), expected);
    db.tables.cbt_bank_questions.reverse();
    db.tables.cbt_bank_questions.find(q => q.id === 'first').updated_at = '2026-10-16T00:00:00Z';
    assert.deepEqual((await service.getReviewData(user('a'), 'session')).questions.map(q => q.id), expected);
    assert.equal(db.writes.length, 0);
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

test('Review notifications target owner, link to feedback and skip identical retries', async () => {
    const { service, db } = setup();
    await service.submitReview(user('a'), 'session', recommendation('revision_needed'));
    const notifications = db.tables.cbt_notifications;
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].user_id, 'owner');
    assert.match(notifications[0].action_url, /tab=validations&validation=session/);
    await service.submitReview(user('a'), 'session', recommendation('revision_needed'));
    assert.equal(db.tables.cbt_notifications.length, 1);
    await service.submitReview(user('a'), 'session', recommendation('approved'));
    assert.equal(db.tables.cbt_notifications.length, 2);
});

test('Identical resubmission recovers a legacy review with no owner notification once', async () => {
    const { service, db } = setup();
    Object.assign(db.tables.cbt_question_bank_validators[0], {
        status: 'submitted', general_recommendation: 'revision_needed', general_comment: '',
    });
    db.tables.cbt_question_bank_validations[0].status = 'revision_needed';
    await service.submitReview(user('a'), 'session', recommendation('revision_needed'));
    assert.equal(db.tables.cbt_notifications.length, 1);
    assert.equal(db.tables.cbt_notifications[0].user_id, 'owner');
    await service.submitReview(user('a'), 'session', recommendation('revision_needed'));
    assert.equal(db.tables.cbt_notifications.length, 1);
});

test('Identical manual decision recovers its missing notification once', async () => {
    const { service, db } = setup('admin_decides');
    db.tables.cbt_question_bank_validators.forEach(row => { row.status = 'submitted'; });
    db.tables.cbt_question_bank_validations[0].status = 'revision_needed';
    await service.decide(user('admin'), 'session', 'revision_needed');
    await service.decide(user('admin'), 'session', 'revision_needed');
    assert.equal(db.tables.cbt_notifications.length, 1);
});
test('Notification failure rolls back review; owner receives decision once', async () => {
    const broken = setup('any', { failMutation: { table: 'cbt_notifications', mutation: 'insert' } });
    await assert.rejects(broken.service.submitReview(user('a'), 'session', recommendation('approved')));
    assert.equal(broken.db.tables.cbt_question_bank_validators[0].status, 'assigned');
    const { service, db } = setup('admin_decides');
    for (const id of ['a','b']) await service.submitReview(user(id), 'session', recommendation('approved'));
    await service.decide(user('admin'), 'session', 'approved');
    assert.equal(db.tables.cbt_notifications.length, 3);
    await service.decide(user('admin'), 'session', 'approved');
    assert.equal(db.tables.cbt_notifications.length, 3);
});
test('Feedback read failure is not reported as empty history', async () => {
    const { service } = setup('any', { failRead: ['cbt_question_bank_validations'] });
    // Other access controls remain exercised by the existing authorization suite.
    const original = service.db;
    service.db = { from: () => ({ select() { return this; }, eq() { return this; }, order: async () => ({ error: { message: 'unavailable' }, data: null }) }) };
    await assert.rejects(service.getBankFeedback(user('owner'), 'bank'), /belum dapat dimuat/);
    service.db = original;
});

// ── Audit validasi: penunjukan, batas waktu, hapus catatan, aturan & otorisasi ──
const { BadRequestException, NotFoundException } = require('@nestjs/common');
const withRoles = (authz, override) => {
    const original = authz.roles.hasOrgRole.bind(authz.roles);
    authz.roles.hasOrgRole = async (id, org, roles) => {
        const result = override(id, org, roles);
        return result === undefined ? original(id, org, roles) : result;
    };
};
const createDto = extra => ({ bankId: 'bank', validatorIds: ['a', 'b'], ...extra });

test('Create rejects non-staff validators, the bank owner and past deadlines without writes', async () => {
    const { db, authz, service } = setup();
    withRoles(authz, id => (id === 'student' ? false : undefined));
    await assert.rejects(service.create(user('admin'), createDto({ validatorIds: ['a', 'student'] })), /staf aktif/);
    await assert.rejects(service.create(user('admin'), createDto({ validatorIds: ['owner'] })), /Pembuat bank soal/);
    await assert.rejects(service.create(user('admin'), createDto({ deadline: '2020-01-01T00:00:00Z' })), /masa depan/);
    assert.equal(db.tables.cbt_question_bank_validations.length, 1);
    assert.equal(db.tables.cbt_question_bank_validators.length, 2);
    const created = await service.create(user('admin'), createDto({ validatorIds: ['a', 'a', 'b'], deadline: '2999-01-01T00:00:00Z' }));
    assert.equal(db.tables.cbt_question_bank_validators.filter(v => v.validation_id === created.id).length, 2);
});

test('Expired deadline blocks notes, deletions and recommendations', async () => {
    const { db, service } = setup();
    db.tables.cbt_question_validation_notes.push({ id: 'mine', validation_id: 'session', question_id: 'q1', validator_id: 'a', is_resolved: false });
    db.tables.cbt_question_bank_validations[0].deadline = '2020-01-01T00:00:00Z';
    await assert.rejects(service.saveNote(user('a'), 'session', note()), /Batas waktu/);
    await assert.rejects(service.deleteNote(user('a'), 'session', 'mine'), /Batas waktu/);
    await assert.rejects(service.submitReview(user('a'), 'session', recommendation('approved')), /Batas waktu/);
    assert.equal(db.tables.cbt_question_validation_notes.length, 1);
    assert.equal(db.tables.cbt_question_bank_validators[0].status, 'assigned');
});

test('Validators delete only their own unresolved notes and missing notes are reported', async () => {
    const { db, service } = setup();
    db.tables.cbt_question_validation_notes.push(
        { id: 'mine', validation_id: 'session', question_id: 'q1', validator_id: 'a', is_resolved: false },
        { id: 'theirs', validation_id: 'session', question_id: 'q1', validator_id: 'b', is_resolved: false },
        { id: 'fixed', validation_id: 'session', question_id: 'q1', validator_id: 'a', is_resolved: true },
    );
    await assert.rejects(service.deleteNote(user('a'), 'session', 'theirs'), ForbiddenException);
    await assert.rejects(service.deleteNote(user('a'), 'session', 'fixed'), BadRequestException);
    await assert.rejects(service.deleteNote(user('a'), 'session', 'missing'), NotFoundException);
    assert.deepEqual(await service.deleteNote(user('a'), 'session', 'mine'), { id: 'mine', deleted: true });
    assert.deepEqual(db.tables.cbt_question_validation_notes.map(n => n.id), ['theirs', 'fixed']);
});

test('Unanimous rule does not settle on an early rejection or revision', async () => {
    const { db, service } = setup('unanimous');
    await service.submitReview(user('a'), 'session', recommendation('rejected'));
    assert.equal(db.tables.cbt_question_bank_validations[0].status, 'in_progress');
    await service.submitReview(user('a'), 'session', recommendation('revision_needed'));
    assert.equal(db.tables.cbt_question_bank_validations[0].status, 'in_progress');
    await service.submitReview(user('b'), 'session', recommendation('rejected'));
    assert.equal(db.tables.cbt_question_bank_validations[0].status, 'revision_needed');
});

test('Restricted proctor cannot decide on an unpublished bank owned by someone else', async () => {
    const { db, authz, service } = setup('admin_decides');
    withRoles(authz, (id, org, roles) => (id === 'proktor' ? org === 'school' && roles.includes('Proktor') : undefined));
    db.tables.cbt_question_bank_validators.forEach(row => { row.status = 'submitted'; });
    const proktor = { id: 'proktor', organizationId: 'school', roles: ['PROKTOR'], isPlatformAdmin: false };
    await assert.rejects(service.decide(proktor, 'session', 'approved'), ForbiddenException);
    db.tables.cbt_question_banks[0].is_published = true;
    await service.decide(proktor, 'session', 'approved');
    assert.equal(db.tables.cbt_question_bank_validations[0].status, 'approved');
});

test('Resolve fails closed when the note bank cannot be determined', async () => {
    const { db, service } = setup();
    db.tables.cbt_question_validation_notes.push({ id: 'orphan', validation_id: 'session', question_id: 'q1', validator_id: 'a', is_resolved: false });
    await assert.rejects(service.resolveNote(user('owner'), 'orphan', true), NotFoundException);
    assert.equal(db.tables.cbt_question_validation_notes[0].is_resolved, false);
});

test('Review options follow the stored order so letters match the exam', async () => {
    const { db, service } = setup();
    db.tables.cbt_bank_questions.find(q => q.id === 'q1').bank_question_options = [
        { id: 'c', order: 2 }, { id: 'a', order: 0 }, { id: 'b', order: 1 }, { id: 'a', order: 0 },
    ];
    const review = await service.getReviewData(user('a'), 'session');
    assert.deepEqual(review.questions.find(q => q.id === 'q1').bank_question_options.map(o => o.id), ['a', 'b', 'c']);
});

test('List rejects malformed bank filters instead of returning an empty list', async () => {
    const { service } = setup();
    await assert.rejects(service.list(user('admin'), 'not-a-uuid'), /tidak valid/);
});
