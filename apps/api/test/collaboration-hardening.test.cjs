const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { AuthorizationService } = require('../src/auth/authorization.service.ts');
const { CollaborationService } = require('../src/auth/collaboration.service.ts');
const { QuestionBanksService } = require('../src/questions/question-banks.service.ts');
const { ExamAdminService } = require('../src/proctor/exam-admin.service.ts');
const { ValidationsService } = require('../src/validations/validations.service.ts');
const { collaboratorCounts } = require('../src/common/collaboration-access.ts');

const user = id => ({ id, isPlatformAdmin: false });
const future = days => new Date(Date.now() + days * 86_400_000).toISOString();
function fixture({ banks = 1, exams = 1 } = {}) {
    const staff = ['a', 'b', 'c', 'manager', 'admin'];
    const db = fixtureDb({
        cbt_question_banks: Array.from({ length: banks }, (_, i) => ({ id: i ? `bank-${i}` : 'bank', organization_id: 'school', created_by: 'a', is_published: false, title: `Bank ${i}` })),
        cbt_exams: Array.from({ length: exams }, (_, i) => ({ id: i ? `exam-${i}` : 'exam', organization_id: 'school', created_by: 'a', is_published: false, exam_type: 'daily', title: `Exam ${i}` })),
        cbt_profiles: staff.map(id => ({ id, full_name: id })),
        cbt_organization_members: staff.map(id => ({ id: 'member-' + id, user_id: id, organization_id: 'school', is_active: true, profiles: { full_name: id },
            member_roles: [{ roles: { name: id === 'admin' ? 'Admin' : 'Guru' } }] })),
        cbt_bank_collaborators: [], cbt_exam_collaborators: [], cbt_collaboration_events: [],
        cbt_exam_question_sources: [], cbt_question_bank_validations: [], cbt_question_bank_validators: [],
    });
    const roles = { hasOrgRole: async (id, org, allowed) => org === 'school' && staff.includes(id) && allowed.includes(id === 'admin' ? 'Admin' : 'Guru') };
    const auth = new AuthorizationService(db, roles, { assertSchoolId: async id => id });
    return { db, roles, auth, service: new CollaborationService(db, auth) };
}

test('a manager cannot hand out access that outlives their own', async () => {
    const f = fixture();
    const own = future(10);
    await f.service.save(user('a'), 'exam', 'exam', 'manager', { permission: 'manager', expires_at: own });
    await assert.rejects(f.service.save(user('manager'), 'exam', 'exam', 'b', { permission: 'editor' }), /melewati batas akses Anda/);
    await assert.rejects(f.service.save(user('manager'), 'exam', 'exam', 'b', { permission: 'editor', expires_at: future(11) }), /melewati batas akses Anda/);
    await f.service.save(user('manager'), 'exam', 'exam', 'b', { permission: 'editor', expires_at: future(9) });
    // Owners and Admin are not capped.
    await f.service.save(user('a'), 'exam', 'exam', 'c', { permission: 'editor' });
});

test('a manager editing an editor keeps the reset right granted by the owner, but cannot grant a new one', async () => {
    const f = fixture();
    await f.service.save(user('a'), 'exam', 'exam', 'manager', { permission: 'manager' });
    await f.service.save(user('a'), 'exam', 'exam', 'c', { permission: 'editor', can_reset: true });
    await f.service.save(user('manager'), 'exam', 'exam', 'c', { permission: 'editor', can_reset: false, expires_at: future(5) });
    const row = f.db.tables.cbt_exam_collaborators.find(grant => grant.user_id === 'c');
    assert.equal(row.can_reset, true);
    assert.equal((await f.auth.getExamResetScope(user('c'), f.db.tables.cbt_exams[0])).allParticipants, true);
    await assert.rejects(f.service.save(user('manager'), 'exam', 'exam', 'b', { permission: 'editor', can_reset: true }), /Hanya pembuat atau Admin/);
    // Downgrading to reader always removes the reset right.
    await f.service.save(user('manager'), 'exam', 'exam', 'c', { permission: 'viewer' });
    assert.equal(f.db.tables.cbt_exam_collaborators.find(grant => grant.user_id === 'c').can_reset, false);
});

test('a manager cannot revive an expired reset right when renewing ordinary editor access', async () => {
    const f = fixture();
    await f.service.save(user('a'), 'exam', 'exam', 'manager', { permission: 'manager' });
    await f.service.save(user('a'), 'exam', 'exam', 'c', { permission: 'editor', can_reset: true });
    const row = f.db.tables.cbt_exam_collaborators.find(grant => grant.user_id === 'c');
    row.expires_at = future(-1);
    await assert.rejects(f.service.save(user('manager'), 'exam', 'exam', 'c', { permission: 'editor', can_reset: true }), /Hanya pembuat atau Admin/);
    await f.service.save(user('manager'), 'exam', 'exam', 'c', { permission: 'editor', expires_at: future(5) });
    assert.equal(f.db.tables.cbt_exam_collaborators.find(grant => grant.user_id === 'c').can_reset, false);
    assert.equal(await f.auth.getExamResetScope(user('c'), f.db.tables.cbt_exams[0]), null);
});

test('only the owner or Admin may extend the lifetime of a reset right', async () => {
    const f = fixture();
    await f.service.save(user('a'), 'exam', 'exam', 'manager', { permission: 'manager' });
    const expiry = future(2);
    await f.service.save(user('a'), 'exam', 'exam', 'c', { permission: 'editor', can_reset: true, expires_at: expiry });
    for (const expires_at of [null, future(3)]) {
        await assert.rejects(f.service.save(user('manager'), 'exam', 'exam', 'c', { permission: 'editor', expires_at }), /Hanya pembuat atau Admin/);
    }
    await f.service.save(user('manager'), 'exam', 'exam', 'c', { permission: 'editor', expires_at: expiry });
    await f.service.save(user('manager'), 'exam', 'exam', 'c', { permission: 'editor', expires_at: future(1) });
    await f.service.save(user('a'), 'exam', 'exam', 'c', { permission: 'editor', can_reset: true, expires_at: future(3) });
    assert.equal(f.db.tables.cbt_exam_collaborators.find(grant => grant.user_id === 'c').can_reset, true);
});

test('readers and editors see only their own access row; sharers see everyone', async () => {
    const f = fixture();
    await f.service.save(user('a'), 'bank', 'bank', 'b', { permission: 'viewer' });
    await f.service.save(user('a'), 'bank', 'bank', 'c', { permission: 'editor' });
    assert.deepEqual((await f.service.list(user('b'), 'bank', 'bank')).collaborators.map(row => row.user_id), ['b']);
    assert.deepEqual((await f.service.list(user('a'), 'bank', 'bank')).collaborators.map(row => row.user_id).sort(), ['b', 'c']);
});

test('lists batch roles, own grants and collaborator counts, not per bank or exam', async () => {
    const count = async size => {
        const f = fixture({ banks: size, exams: size });
        // Seeded directly: the in-memory fixture's upsert does not model composite conflict keys.
        f.db.tables.cbt_bank_collaborators = f.db.tables.cbt_question_banks.map(bank => ({ bank_id: bank.id, user_id: 'b', permission: 'editor', granted_by: 'a' }));
        const banks = new QuestionBanksService(f.db, f.auth, f.roles, { emailMap: async () => new Map() });
        const before = f.db.queries.length;
        const listed = await banks.list(user('b'), 'school');
        assert.equal(listed.length, size);
        assert.deepEqual(listed.map(bank => [bank.canManage, bank.canDelete, bank.collaborationPermission]), listed.map(() => [true, false, 'editor']));
        return f.db.queries.length - before;
    };
    assert.equal(await count(1), await count(15));

    const f = fixture({ exams: 12 });
    await f.service.save(user('a'), 'exam', 'exam', 'b', { permission: 'editor', can_reset: true });
    const before = f.db.queries.filter(query => query.table === 'cbt_exam_collaborators').length;
    const exams = await new ExamAdminService(f.db, f.auth, f.roles).list(user('b'), 'school');
    const shared = exams.find(exam => exam.id === 'exam');
    assert.deepEqual([shared.canManage, shared.canResetParticipants, shared.canDelete], [true, true, false]);
    assert.equal(f.db.queries.filter(query => query.table === 'cbt_exam_collaborators').length - before, 2);
});

test('bank and exam lists count active collaborators and refresh after revocation without exposing names', async () => {
    for (const type of ['bank', 'exam']) {
        const f = fixture({ banks: 3, exams: 3 });
        const key = type === 'bank' ? 'bank_id' : 'exam_id';
        f.db.tables[`cbt_${type}_collaborators`] = [
            { [key]: type, user_id: 'b', permission: 'viewer' },
            { [key]: type, user_id: 'c', permission: 'editor', expires_at: future(1) },
            { [key]: type, user_id: 'manager', permission: 'manager' },
            { [key]: type, user_id: 'revoked', permission: 'editor', revoked_at: future(-1) },
            { [key]: type, user_id: 'expired', permission: 'editor', expires_at: future(-1) },
            { [key]: type, user_id: 'invalid-date', permission: 'editor', expires_at: 'invalid' },
            { [key]: type, user_id: 'invalid-permission', permission: 'invalid' },
            { [key]: `${type}-1`, user_id: 'b', permission: 'editor' },
            { [key]: 'foreign-resource', user_id: 'b', permission: 'editor' },
        ];
        const service = type === 'bank'
            ? new QuestionBanksService(f.db, f.auth, f.roles, { emailMap: async () => new Map() })
            : new ExamAdminService(f.db, f.auth, f.roles);
        const listed = await service.list(user('a'), 'school');
        assert.deepEqual(listed.map(row => [row.id, row.collaboratorCount]), [[type, 3], [`${type}-1`, 1], [`${type}-2`, 0]]);
        if (type === 'bank') assert.equal((await service.get(user('a'), type)).collaboratorCount, 3);
        const reader = await f.service.list(user('b'), type, type);
        assert.equal(reader.activeCount, 3);
        assert.deepEqual(reader.collaborators.map(row => row.user_id), ['b']);
        await f.service.revoke(user('a'), type, type, 'c');
        assert.equal((await f.service.list(user('a'), type, type)).activeCount, 2);
        assert.equal((await service.list(user('a'), 'school')).find(row => row.id === type).collaboratorCount, 2);
    }
});

test('collaborator counts use bounded batches and report database failures instead of claiming zero', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `bank-${i}`);
    const db = fixtureDb({ cbt_bank_collaborators: ids.map(bank_id => ({ bank_id, user_id: 'b', permission: 'editor' })) });
    assert.equal((await collaboratorCounts(db, 'bank', ids)).size, 501);
    assert.equal(db.queries.length, 2);
    const empty = fixtureDb();
    assert.equal((await collaboratorCounts(empty, 'exam', [])).size, 0);
    assert.equal(empty.queries.length, 0);
    await assert.rejects(collaboratorCounts(fixtureDb({}, ['cbt_bank_collaborators']), 'bank', ['bank']), /Jumlah kolaborator belum dapat diperiksa/);
});

test('co-editors of a bank cannot be assigned as its validators', async () => {
    const f = fixture();
    await f.service.save(user('a'), 'bank', 'bank', 'b', { permission: 'editor' });
    await f.service.save(user('a'), 'bank', 'bank', 'c', { permission: 'viewer' });
    const authz = { assertProktor: async () => {}, assertBankAccess: async () => 'school', hasOrgStaffRole: async () => true };
    const validations = new ValidationsService(f.db, authz);
    await assert.rejects(validations.create(user('admin'), { bankId: 'bank', validatorIds: ['b'] }), /Editor atau pengelola bank soal ini/);
    // A reader is not a co-author and stays eligible.
    await validations.create(user('admin'), { bankId: 'bank', validatorIds: ['c'] });
});

test('backup restore skips collaborators whose accounts are not in the target environment', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/backup/backup.service.ts'), 'utf8');
    assert.match(source, /insert\('cbt_bank_collaborators', withUser\(data\.bank_collaborators\)/);
    assert.match(source, /insert\('cbt_exam_collaborators', withUser\(data\.exam_collaborators\)/);
});

test('system writes no longer change the exam version used by the edit form', () => {
    const migration = fs.readFileSync(path.resolve(__dirname, '../../../database/migrations/20261023_03_exam_version_explicit.sql'), 'utf8');
    assert.match(migration, /DROP TRIGGER IF EXISTS cbt_exams_collaboration_version ON public\.cbt_exams/);
    assert.match(fs.readFileSync(path.resolve(__dirname, '../src/proctor/exam-admin.service.ts'), 'utf8'), /updated_at: new Date\(\)\.toISOString\(\),\s+title,/);
});

test('bank editors cannot publish or withdraw the bank; owner and manager can', async () => {
    const f = fixture();
    await f.service.save(user('a'), 'bank', 'bank', 'b', { permission: 'editor' });
    await f.service.save(user('a'), 'bank', 'bank', 'manager', { permission: 'manager' });
    const banks = new QuestionBanksService(f.db, f.auth, f.roles, { emailMap: async () => new Map() });
    await assert.rejects(banks.setPublished(user('b'), 'bank', true), /pembuat, Admin, atau pengelola/);
    assert.equal(f.db.tables.cbt_question_banks[0].is_published, false);
    await banks.setPublished(user('manager'), 'bank', true);
    assert.equal(f.db.tables.cbt_question_banks[0].is_published, true);
    await banks.setPublished(user('a'), 'bank', false);
    assert.equal(f.db.tables.cbt_question_banks[0].is_published, false);
});
