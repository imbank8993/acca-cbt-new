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
const schoolScope = { getSchool: async () => ({ id: 'target', name: 'School' }) };

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
    const service = new BackupService(db, authz, authUsers, schoolScope);

    await assert.rejects(
        service.import(user, payload({
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
    const service = new BackupService(db, authz, authUsers, schoolScope);

    await assert.rejects(
        service.import(user, payload({
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
    const service = new BackupService(db, authz, authUsers, schoolScope);

    await assert.rejects(
        service.export(user),
        error => error.getStatus?.() === 400 && /cbt_subjects/.test(String(error.message)),
    );
});

test('SEC-12: import authorization checks permission and organization only', async () => {
    let checked = false;
    const db = fixtureDb({ cbt_organizations: [{ id: 'target' }] });
    const service = new BackupService(db, {
        assertProktor: async (_user, orgId) => { checked = orgId === 'target'; },
    }, authUsers, schoolScope);

    assert.deepEqual(await service.authorizeImport(user), { authorized: true });
    assert.equal(checked, true);
    assert.equal(db.writes.length, 0);
});

test('SCHOOL-07: restore menimpa semua organization_id arsip dengan sekolah lokal', async () => {
    const db = fixtureDb({
        cbt_organizations: [{ id: 'target', name: 'School' }],
        cbt_organization_members: [{ id: 'member', organization_id: 'target', user_id: user.id }],
    });
    const service = new BackupService(db, authz, authUsers, schoolScope);

    await service.import(user, payload({
        question_banks: [{ id: 'bank', organization_id: 'foreign' }],
        question_stimuli: [{ id: 'stimulus', bank_id: 'bank', organization_id: 'foreign' }],
        question_instructions: [{ id: 'instruction', bank_id: 'bank', organization_id: 'foreign' }],
    }));

    assert.equal(db.tables.cbt_question_banks[0].organization_id, 'target');
    assert.equal(db.tables.cbt_question_stimuli[0].organization_id, 'target');
    assert.equal(db.tables.cbt_question_instructions[0].organization_id, 'target');
});

test('SCHOOL-08: identitas pengguna duplikat ditolak sebelum data dihapus', async () => {
    const db = fixtureDb({
        cbt_classes: [{ id: 'old', organization_id: 'target' }],
    });
    const service = new BackupService(db, authz, authUsers, schoolScope);
    const duplicateUsers = [
        { original_user_id: 'same', email: 'one@example.test' },
        { original_user_id: 'same', email: 'two@example.test' },
    ];

    await assert.rejects(
        service.import(user, payload({ users_data: duplicateUsers })),
        error => error.getStatus?.() === 400 && /original_user_id duplikat/i.test(error.message),
    );
    assert.deepEqual(db.tables.cbt_classes, [{ id: 'old', organization_id: 'target' }]);
    assert.equal(db.writes.length, 0);
});

for (const scoped of [false, true]) {
    test(`restore ${scoped ? 'session-specific' : 'legacy room-wide'} invigilators preserves assignments per session`, async () => {
        const db = fixtureDb({ cbt_roles: [{ id: 'role-guru', name: 'Guru' }] });
        const service = new BackupService(db, authz, authUsers, schoolScope);
        service.prepareUsers = async () => new Map([['teacher', 'local-teacher']]);
        await service.import(user, payload({
            users_data: [{ original_user_id: 'teacher', email: 'teacher@example.test', role: 'Guru' }],
            pas_periods: [{ id: 'p' }], pas_rooms: [{ id: 'r', pas_period_id: 'p' }],
            pas_sessions: [{ id: 's1', pas_period_id: 'p' }, { id: 's2', pas_period_id: 'p' }],
            pas_room_invigilators: scoped
                ? [{ id: 'a', pas_room_id: 'r', user_id: 'teacher', session_id: 's1' },
                    { id: 'b', pas_room_id: 'r', user_id: 'teacher', session_id: 's2' }]
                : [{ id: 'a', pas_room_id: 'r', user_id: 'teacher' }],
        }));
        const rows = db.tables.cbt_pas_room_invigilators;
        assert.deepEqual(rows.map(row => row.session_id).sort(), ['s1', 's2']);
        assert.equal(new Set(rows.map(row => row.id)).size, 2);
        assert.ok(rows.every(row => row.user_id === 'local-teacher'));
    });
}

test('restore rejects room/session assignments across periods before any writes', async () => {
    const db = fixtureDb();
    const service = new BackupService(db, authz, authUsers, schoolScope);
    await assert.rejects(service.import(user, payload({
        users_data: [{ original_user_id: 'teacher', email: 'teacher@example.test' }],
        pas_periods: [{ id: 'p1' }, { id: 'p2' }], pas_rooms: [{ id: 'r', pas_period_id: 'p1' }],
        pas_sessions: [{ id: 's', pas_period_id: 'p2' }],
        pas_room_invigilators: [{ id: 'a', pas_room_id: 'r', session_id: 's', user_id: 'teacher' }],
    })), /periode yang sama/);
    assert.equal(db.writes.length, 0);
});
