// Run from repository root: node --test apps/api/test/backup-integrity-stage5.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { BackupService } = require('../src/backup/backup.service.ts');

const user = { id: 'operator', isPlatformAdmin: false };
const authz = { assertProktor: async () => undefined };
const authUsers = {
    listUsers: async () => [],
    emailMap: async () => new Map(),
    softDeleteUser: async () => undefined,
};

function payload(overrides = {}) {
    return {
        version: '2.0',
        timestamp: '2026-09-25T00:00:00Z',
        organization: { id: 'source', name: 'Source' },
        data: {
            users_data: [], classes: [], class_members: [], subjects: [],
            bank_categories: [], question_banks: [], question_stimuli: [],
            bank_questions: [], bank_question_options: [], exams: [],
            exam_attempts: [], answers: [], ...overrides,
        },
    };
}

test('BUG-04: invalid references are rejected before destructive writes', async () => {
    const db = fixtureDb({
        cbt_classes: [{ id: 'old', organization_id: 'target' }],
    });
    const service = new BackupService(db, authz, authUsers);

    await assert.rejects(
        service.import(user, 'target', payload({
            answers: [{ id: 'answer', attempt_id: 'missing', question_id: 'q' }],
        })),
        error => error.getStatus?.() === 400,
    );
    assert.deepEqual(db.tables.cbt_classes, [{ id: 'old', organization_id: 'target' }]);
    assert.equal(db.writes.length, 0);
});

test('BUG-04: a mid-restore database failure rolls back the organization', async () => {
    const db = fixtureDb({
        cbt_classes: [{ id: 'old', organization_id: 'target' }],
        cbt_organization_members: [{ id: 'member', organization_id: 'target', user_id: user.id }],
    }, [], { failMutation: { table: 'cbt_question_banks', mutation: 'insert' } });
    const service = new BackupService(db, authz, authUsers);

    await assert.rejects(
        service.import(user, 'target', payload({
            classes: [{ id: 'new' }],
            question_banks: [{ id: 'bank' }],
        })),
        error => error.getStatus?.() === 400,
    );
    assert.deepEqual(db.tables.cbt_classes, [{ id: 'old', organization_id: 'target' }]);
    assert.deepEqual(db.tables.cbt_organization_members, [
        { id: 'member', organization_id: 'target', user_id: user.id },
    ]);
});

test('BUG-05: export fails closed when any covered table cannot be read', async () => {
    const db = fixtureDb({
        cbt_organizations: [{ id: 'target', name: 'School' }],
        cbt_organization_members: [],
    }, ['cbt_subjects']);
    const service = new BackupService(db, authz, authUsers);

    await assert.rejects(
        service.export(user, 'target'),
        error => error.getStatus?.() === 400 && /cbt_subjects/.test(String(error.message)),
    );
});

test('SEC-12: import authorization checks permission and organization only', async () => {
    let checked = false;
    const db = fixtureDb({ cbt_organizations: [{ id: 'target' }] });
    const service = new BackupService(db, {
        assertProktor: async (_user, orgId) => { checked = orgId === 'target'; },
    }, authUsers);

    assert.deepEqual(await service.authorizeImport(user, 'target'), { authorized: true });
    assert.equal(checked, true);
    assert.equal(db.writes.length, 0);
});
