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
test('Validation print data uses the configured school letterhead and logo', async () => {
    const { db, service } = setup();
    db.tables.profil_sekolah = [{ nama: 'MAN Insan Cendekia Gowa', jenjang: 'MA', alamat: 'Jl. Pendidikan', logo_url: 'https://school.example/logo.png' }];
    db.tables.cbt_organizations = [{ id: 'school', name: 'School fallback', logo_url: 'https://school.example/fallback.png' }];
    const review = await service.getReviewData(user('a'), 'session');
    assert.equal(review.profil_sekolah.nama, 'MAN Insan Cendekia Gowa');
    assert.equal(review.profil_sekolah.logo_url, 'https://school.example/logo.png');
    assert.equal(review.profil_sekolah.alamat, 'Jl. Pendidikan');
});

test('Validation letterhead falls back to its own organization logo', async () => {
    const { db, service } = setup();
    db.tables.cbt_organizations = [
        { id: 'other-school', name: 'Other', logo_url: 'https://other.example/logo.png' },
        { id: 'school', name: 'Own school', logo_url: 'https://school.example/logo.png' },
    ];
    const review = await service.getReviewData(user('a'), 'session');
    assert.equal(review.profil_sekolah.nama, 'Own school');
    assert.equal(review.profil_sekolah.logo_url, 'https://school.example/logo.png');
});

// ── Putaran telaah ulang, independensi, status per butir & kelola sesi ──
const resolveAll = db => db.tables.cbt_question_validation_notes.forEach(row => { row.is_resolved = true; });
const sessionRow = db => db.tables.cbt_question_bank_validations[0];
const withValidation = db => db.tables.cbt_question_validation_notes.forEach(row => {
    // Fixture tidak menelusuri relasi; isi seperti hasil join PostgREST.
    row.validation = { bank_id: 'bank', organization_id: 'school', status: sessionRow(db).status };
});

test('Re-review does not require fixing notes that already marked the item valid', async () => {
    const { db, service } = setup();
    Object.assign(sessionRow(db), { round: 2, status: 'resubmitted' });
    db.tables.cbt_question_validation_notes.push({
        id: 'positive', validation_id: 'session', question_id: 'q1', validator_id: 'a',
        round: 1, status_item: 'valid', is_resolved: false, verification: null,
    });
    await service.submitReview(user('a'), 'session', recommendation('approved'));
    assert.equal(sessionRow(db).status, 'approved');
});

test('Owner correction rechecks session status after acquiring the validation lock', async () => {
    const { db, service } = setup();
    const saved = await service.saveNote(user('a'), 'session', note());
    withValidation(db);
    const raw = db.raw.bind(db);
    db.raw = async (sql, ...args) => {
        if (/pg_advisory_xact_lock/.test(sql)) sessionRow(db).status = 'resubmitted';
        return raw(sql, ...args);
    };
    await assert.rejects(service.resolveNote(user('owner'), saved.id, true), /ditelaah ulang/);
    assert.notEqual(db.tables.cbt_question_validation_notes.find(row => row.id === saved.id).is_resolved, true);
});

test('Assigned validators are notified with a link to their review sheet', async () => {
    const { db, service } = setup();
    const created = await service.create(user('admin'), createDto({ deadline: '2999-01-01T00:00:00Z' }));
    const sent = db.tables.cbt_notifications.filter(n => n.data?.validationId === created.id);
    assert.deepEqual(sent.map(n => n.user_id).sort(), ['a', 'b']);
    assert.match(sent[0].action_url, new RegExp(`/dashboard/guru/validations/${created.id}/review`));
});

test('Validators see only their own notes and recommendations until they submit', async () => {
    const { db, service } = setup();
    db.tables.cbt_question_validation_notes.push(
        { id: 'mine', validation_id: 'session', question_id: 'q1', validator_id: 'a', is_resolved: false },
        { id: 'theirs', validation_id: 'session', question_id: 'q1', validator_id: 'b', is_resolved: false },
    );
    db.tables.cbt_question_validation_items = [
        { id: 'i1', validation_id: 'session', question_id: 'q1', validator_id: 'a', status: 'valid' },
        { id: 'i2', validation_id: 'session', question_id: 'q1', validator_id: 'b', status: 'rejected' },
    ];
    Object.assign(db.tables.cbt_question_bank_validators[1], { status: 'submitted', general_recommendation: 'rejected', general_comment: 'Tolak' });
    let review = await service.getReviewData(user('a'), 'session');
    assert.deepEqual(review.notes.map(n => n.id), ['mine']);
    assert.deepEqual(review.items.map(i => i.id), ['i1']);
    assert.equal((await service.getReviewData(user('owner'), 'session')).notes.length, 2);
    await service.submitReview(user('a'), 'session', recommendation('approved'));
    review = await service.getReviewData(user('a'), 'session');
    assert.deepEqual(review.notes.map(n => n.id).sort(), ['mine', 'theirs']);
});

test('Notes lock after submission; reopening recomputes status and the next submission notifies the owner', async () => {
    const { db, service } = setup();
    await service.submitReview(user('a'), 'session', recommendation('approved'));
    assert.equal(sessionRow(db).status, 'approved');
    await assert.rejects(service.saveNote(user('a'), 'session', note()), /Buka kembali/);
    await assert.rejects(service.setItemStatus(user('a'), 'session', 'q1', 'valid'), /Buka kembali/);
    await service.reopen(user('a'), 'session');
    assert.equal(db.tables.cbt_question_bank_validators[0].status, 'in_progress');
    assert.equal(sessionRow(db).status, 'in_progress');
    await service.saveNote(user('a'), 'session', note());
    const before = db.tables.cbt_notifications.length;
    await service.submitReview(user('a'), 'session', recommendation('approved'));
    assert.equal(db.tables.cbt_notifications.length, before + 1);
    await assert.rejects(service.reopen(user('owner'), 'session'), ForbiddenException);
});

test('Item status is stored once per validator and question, and rejects foreign questions', async () => {
    const { db, service } = setup();
    db.tables.cbt_bank_questions.find(q => q.id === 'q1').revision = 4;
    await service.setItemStatus(user('a'), 'session', 'q1', 'revision');
    await service.setItemStatus(user('a'), 'session', 'q1', 'valid');
    const items = db.tables.cbt_question_validation_items;
    assert.equal(items.length, 1);
    assert.equal(items[0].status, 'valid');
    assert.equal(items[0].question_revision, 4);
    assert.equal(db.tables.cbt_question_bank_validators[0].status, 'in_progress');
    await assert.rejects(service.setItemStatus(user('a'), 'session', 'foreign', 'valid'), /tidak ditemukan/);
    await assert.rejects(service.setItemStatus(user('owner'), 'session', 'q1', 'valid'), ForbiddenException);
});

test('Notes record the question revision and round they were written against', async () => {
    const { db, service } = setup();
    db.tables.cbt_bank_questions.find(q => q.id === 'q1').revision = 7;
    const saved = await service.saveNote(user('a'), 'session', note());
    assert.equal(saved.question_revision, 7);
    assert.equal(saved.round, 1);
    const edited = await service.updateNote(user('a'), 'session', saved.id, { comment: 'Teks baru', statusItem: 'rejected' });
    assert.equal(edited.comment, 'Teks baru');
    assert.equal(edited.status_item, 'rejected');
    await assert.rejects(service.updateNote(user('b'), 'session', saved.id, { comment: 'x' }), ForbiddenException);
});

test('Owner resubmits after fixing every note; validators re-review and verify fixes', async () => {
    const { db, service } = setup('unanimous');
    await service.saveNote(user('a'), 'session', note());
    await service.saveNote(user('b'), 'session', note({ questionId: 'q2' }));
    for (const id of ['a', 'b']) await service.submitReview(user(id), 'session', recommendation('revision_needed'));
    assert.equal(sessionRow(db).status, 'revision_needed');
    await assert.rejects(service.resubmit(user('owner'), 'session'), /belum ditandai diperbaiki/);
    await assert.rejects(service.resubmit(user('a'), 'session'));
    resolveAll(db);
    sessionRow(db).deadline = '2020-01-01T00:00:00Z';
    const before = db.tables.cbt_notifications.length;
    assert.deepEqual(await service.resubmit(user('owner'), 'session'), { round: 2, status: 'resubmitted' });
    assert.equal(sessionRow(db).status, 'resubmitted');
    assert.equal(sessionRow(db).deadline, null);
    assert.ok(db.tables.cbt_question_bank_validators.every(v => v.status === 'assigned' && v.general_recommendation === null));
    assert.deepEqual(db.tables.cbt_notifications.slice(before).map(n => n.user_id).sort(), ['a', 'b']);

    // Pembuat soal tidak boleh mengubah tanda selama telaah ulang.
    withValidation(db);
    await assert.rejects(service.resolveNote(user('owner'), db.tables.cbt_question_validation_notes[0].id, false), /ditelaah ulang/);

    // Transaksi yang gagal memulihkan tabel dari salinan, jadi baca ulang per id.
    const [idA, idB] = db.tables.cbt_question_validation_notes.map(row => row.id);
    const byId = id => db.tables.cbt_question_validation_notes.find(row => row.id === id);
    await assert.rejects(service.submitReview(user('a'), 'session', recommendation('approved')), /Nilai dulu 1 perbaikan/);
    await assert.rejects(service.deleteNote(user('a'), 'session', idA));
    await assert.rejects(service.verifyNote(user('b'), 'session', idA, 'accepted'), ForbiddenException);
    await service.verifyNote(user('a'), 'session', idA, 'not_fixed');
    assert.equal(byId(idA).is_resolved, false);
    assert.equal(byId(idA).verification, 'not_fixed');
    await service.verifyNote(user('b'), 'session', idB, 'accepted');
    assert.equal(byId(idB).verification, 'accepted');
    await service.submitReview(user('a'), 'session', recommendation('revision_needed'));
    assert.equal(sessionRow(db).status, 'resubmitted');
    await service.submitReview(user('b'), 'session', recommendation('approved'));
    assert.equal(sessionRow(db).status, 'revision_needed');

    // Putaran 3: hanya catatan yang dibuka kembali yang perlu diperbaiki lagi.
    withValidation(db);
    await service.resolveNote(user('owner'), idA, true, 'Pilihan B sudah diganti');
    assert.equal(byId(idA).owner_response, 'Pilihan B sudah diganti');
    assert.equal(byId(idA).verification, null);
    assert.equal((await service.resubmit(user('owner'), 'session')).round, 3);
});

test('Verification needs a fix from a later round and a resolved note to accept', async () => {
    const { db, service } = setup();
    const saved = await service.saveNote(user('a'), 'session', note());
    await assert.rejects(service.verifyNote(user('a'), 'session', saved.id, 'accepted'), /belum melalui/);
    Object.assign(sessionRow(db), { round: 2, status: 'resubmitted' });
    await assert.rejects(service.verifyNote(user('a'), 'session', saved.id, 'accepted'), /belum menandai/);
});

test('Admin edits deadline and validators; started validators cannot be removed', async () => {
    const { db, authz, service } = setup('unanimous');
    withRoles(authz, id => (id === 'c' ? true : undefined));
    await assert.rejects(service.updateSession(user('a'), 'session', { deadline: '2999-01-01T00:00:00Z' }), ForbiddenException);
    await assert.rejects(service.updateSession(user('admin'), 'session', { deadline: '2020-01-01T00:00:00Z' }), /masa depan/);
    await service.updateSession(user('admin'), 'session', { deadline: '2999-01-01T00:00:00Z', instructions: '  Fokus kunci  ' });
    assert.equal(sessionRow(db).instructions, 'Fokus kunci');
    await service.updateSession(user('admin'), 'session', { deadline: null });
    assert.equal(sessionRow(db).deadline, null);

    await assert.rejects(service.updateSession(user('admin'), 'session', { addValidatorIds: ['owner'] }), /Pembuat bank soal/);
    await service.updateSession(user('admin'), 'session', { addValidatorIds: ['c'] });
    assert.ok(db.tables.cbt_question_bank_validators.some(v => v.validator_id === 'c' && v.status === 'assigned'));
    assert.ok(db.tables.cbt_notifications.some(n => n.user_id === 'c'));

    await service.saveNote(user('a'), 'session', note());
    await assert.rejects(service.updateSession(user('admin'), 'session', { removeValidatorIds: ['a'] }), /sudah mulai/);
    await assert.rejects(service.updateSession(user('admin'), 'session', { removeValidatorIds: ['a', 'b', 'c'] }));
    // Mengeluarkan validator terakhir yang belum mengirim menyelesaikan sesi.
    await service.submitReview(user('a'), 'session', recommendation('approved'));
    await service.submitReview(user('b'), 'session', recommendation('approved'));
    assert.equal(sessionRow(db).status, 'in_progress');
    await service.updateSession(user('admin'), 'session', { removeValidatorIds: ['c'] });
    assert.equal(sessionRow(db).status, 'approved');
    await assert.rejects(service.updateSession(user('admin'), 'session', { addValidatorIds: ['c'] }), /masih berjalan/);
});

test('Only the session creator or an admin deletes a session', async () => {
    const { db, authz, service } = setup();
    withRoles(authz, (id, org, roles) => (id === 'proktor' ? org === 'school' && roles.includes('Proktor') : undefined));
    const proktor = { id: 'proktor', organizationId: 'school', roles: ['PROKTOR'], isPlatformAdmin: false };
    sessionRow(db).created_by = 'someone-else';
    db.tables.cbt_question_banks[0].is_published = true;
    await assert.rejects(service.removeSession(user('a'), 'session'), ForbiddenException);
    await assert.rejects(service.removeSession(proktor, 'session'), /pembuat sesi atau Admin/);
    assert.deepEqual(await service.removeSession(user('admin'), 'session'), { id: 'session', deleted: true });
    assert.equal(db.tables.cbt_question_bank_validations.length, 0);
});

test('Bank cards summarise the latest validation without blocking the list on read errors', async () => {
    const { db, authz } = setup();
    const banks = new QuestionBanksService(db, authz);
    db.tables.cbt_question_bank_validations = [
        { id: 'latest', bank_id: 'bank', status: 'revision_needed', round: 2, notes: [
            { status_item: 'revision', is_resolved: false },
            { status_item: 'rejected', is_resolved: true, verification: null },
            { status_item: 'revision', is_resolved: true, verification: 'accepted' },
            { status_item: 'valid', is_resolved: false },
        ] },
        { id: 'older', bank_id: 'bank', status: 'approved', round: 1, notes: [] },
    ];
    const summary = (await banks['validationSummaries'](['bank'])).get('bank');
    assert.deepEqual(summary, { id: 'latest', status: 'revision_needed', round: 2, openNotes: 1, fixedNotes: 1 });
    const failing = new QuestionBanksService(fixtureDb({}, ['cbt_question_bank_validations']), authz);
    assert.equal((await failing['validationSummaries'](['bank'])).size, 0);
});
