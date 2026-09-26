// Run from repository root: node --test apps/api/test/single-school-stage20.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { SingleSchoolService } = require('../src/auth/single-school.service.ts');

const config = {
    get(key) {
        if (key === 'CBT_ORGANIZATION_NAME') return 'SMA Contoh';
        if (key === 'CBT_ORGANIZATION_SLUG') return 'sma-contoh';
        return undefined;
    },
};

test('SCHOOL-01: satu-satunya sekolah menjadi konteks tetap instalasi', async () => {
    const db = fixtureDb({
        cbt_organizations: [{ id: 'school-1', name: 'Sekolah Satu', logo_url: null }],
    });
    const service = new SingleSchoolService(db, config);

    assert.equal((await service.getSchool()).id, 'school-1');
    assert.equal(await service.assertSchoolId('school-1'), 'school-1');
});

test('SCHOOL-02: ID semua sekolah dan ID sekolah lain ditolak', async () => {
    const db = fixtureDb({ cbt_organizations: [{ id: 'school-1', name: 'Sekolah Satu' }] });
    const service = new SingleSchoolService(db, config);

    for (const organizationId of ['all', 'platform-admin', 'school-2', '', null]) {
        await assert.rejects(
            service.assertSchoolId(organizationId),
            error => error?.getStatus?.() === 400,
        );
    }
});

test('SCHOOL-03: data lebih dari satu sekolah membuat aplikasi gagal tertutup', async () => {
    const db = fixtureDb({
        cbt_organizations: [
            { id: 'school-1', name: 'Sekolah Satu' },
            { id: 'school-2', name: 'Sekolah Dua' },
        ],
    });
    const service = new SingleSchoolService(db, config);

    await assert.rejects(service.getSchool(), error =>
        error?.getStatus?.() === 503 && /lebih dari satu sekolah/i.test(error.message),
    );
});

test('SCHOOL-04: sekolah awal dibuat sekali dari konfigurasi instalasi', async () => {
    const db = fixtureDb({ cbt_organizations: [] });
    const service = new SingleSchoolService(db, config);

    const school = await service.getSchool({ createIfMissing: true });
    assert.equal(school.name, 'SMA Contoh');
    assert.equal(db.tables.cbt_organizations.length, 1);
    assert.equal(db.tables.cbt_organizations[0].slug, 'sma-contoh');
});

test('SCHOOL-05: migrasi dan layanan tidak menyediakan cakupan multi-sekolah', () => {
    const root = path.resolve(__dirname, '../../..');
    const migration = fs.readFileSync(
        path.join(root, 'database/migrations/20260926_03_single_school.sql'),
        'utf8',
    );
    const validator = fs.readFileSync(path.join(root, 'tools/validate-migrations.js'), 'utf8');
    assert.match(migration, /cbt_organizations_singleton/);
    assert.match(migration, /school_count > 1/);
    assert.match(validator, /20260926_03_single_school\.sql/);

    for (const relative of [
        'apps/api/src/questions/question-banks.service.ts',
        'apps/api/src/proctor/exam-admin.service.ts',
        'apps/api/src/proctor/classes.service.ts',
        'apps/api/src/exam-configs/exam-configs.service.ts',
    ]) {
        const source = fs.readFileSync(path.join(root, relative), 'utf8');
        assert.doesNotMatch(source, /organizationId\s*[!=]==?\s*['"]all['"]/);
        assert.doesNotMatch(source, /from\(['"]cbt_organizations['"]\)[\s\S]{0,180}limit\(1\)/);
    }
});

test('SCHOOL-06: kontrak sesi hanya membawa satu organizationId', () => {
    const root = path.resolve(__dirname, '../../..');
    const shared = fs.readFileSync(path.join(root, 'packages/shared/src/api.ts'), 'utf8');
    const auth = fs.readFileSync(path.join(root, 'apps/api/src/auth/auth.service.ts'), 'utf8');
    assert.match(shared, /organizationId: string/);
    assert.doesNotMatch(shared, /organizationId: string \| null/);
    assert.doesNotMatch(shared, /organizationIds/);
    assert.doesNotMatch(auth, /platform-admin/);
});
