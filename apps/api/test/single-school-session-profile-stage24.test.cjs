// Run from repository root: node apps/api/test/single-school-session-profile-stage24.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('SCHOOL-PROFILE-01: sesi membawa nama sekolah dari resolver tunggal', () => {
    const shared = read('packages/shared/src/api.ts');
    const roles = read('apps/api/src/auth/cbt-roles.service.ts');
    const auth = read('apps/api/src/auth/auth.service.ts');
    const jwt = read('apps/api/src/auth/jwt.strategy.ts');
    assert.match(shared, /organizationName: string/);
    assert.match(roles, /organizationName: school\.name \|\| ['"]Sekolah['"]/);
    assert.match(auth, /organizationName: context\.organizationName/);
    assert.match(jwt, /organizationName: context\.organizationName/);
});

test('SCHOOL-PROFILE-02: endpoint organisasi operasional yang redundan dihapus', () => {
    assert.equal(fs.existsSync(path.join(root, 'apps/web/app/api/proctor/organization/route.ts')), false);
    assert.equal(fs.existsSync(path.join(root, 'apps/web/app/api/teachers/organization/route.ts')), false);
    assert.doesNotMatch(read('apps/api/src/proctor/proctor.controller.ts'), /@Get\(['"]organization['"]\)/);
    assert.doesNotMatch(read('apps/api/src/teachers/teachers.controller.ts'), /@Get\(['"]organization['"]\)/);
});

test('SCHOOL-PROFILE-03: helper halaman membaca sekolah dari cache sesi', () => {
    for (const relative of [
        'apps/web/lib/api/proctor.ts',
        'apps/web/lib/api/teachers.ts',
    ]) {
        const source = read(relative);
        assert.match(source, /getSessionUser\(\)/, relative);
        assert.match(source, /user\.organizationName \|\| ['"]Sekolah['"]/, relative);
        assert.doesNotMatch(source, /api\/(?:proctor|teachers)\/organization/, relative);
    }
});

test('SCHOOL-PROFILE-04: service tidak lagi menjalankan query profil sekolah kedua', () => {
    const proctor = read('apps/api/src/proctor/proctor.service.ts');
    const teachers = read('apps/api/src/teachers/teachers.service.ts');
    assert.doesNotMatch(proctor, /getOrganization\(|SingleSchoolService/);
    assert.doesNotMatch(teachers, /async organization\(/);
});
