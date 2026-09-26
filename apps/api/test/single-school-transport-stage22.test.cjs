// Run from repository root: node --test apps/api/test/single-school-transport-stage22.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function collectSourceFiles(relativeDir) {
    const absoluteDir = path.join(root, relativeDir);
    return fs.readdirSync(absoluteDir, { withFileTypes: true }).flatMap(entry => {
        const relative = path.join(relativeDir, entry.name);
        if (entry.isDirectory()) return collectSourceFiles(relative);
        return /\.(?:ts|tsx)$/.test(entry.name) ? [relative] : [];
    });
}

test('SCHOOL-TRANSPORT-01: controller mengambil sekolah dari sesi terverifikasi', () => {
    const controllers = [
        'apps/api/src/analytics/analytics.controller.ts',
        'apps/api/src/teachers/teachers.controller.ts',
        'apps/api/src/questions/questions.controller.ts',
        'apps/api/src/pas/pas.controller.ts',
        'apps/api/src/exam-configs/exam-configs.controller.ts',
        'apps/api/src/proctor/proctor.controller.ts',
    ];

    for (const relative of controllers) {
        const source = read(relative);
        assert.match(source, /@CurrentSchoolId\(\)/, relative);
        assert.doesNotMatch(source, /@Query\(['"]organizationId['"]\)/, relative);
        assert.doesNotMatch(source, /body\.organizationId/, relative);
    }
});

test('SCHOOL-TRANSPORT-02: DTO publik tidak menerima organizationId', () => {
    const dtoFiles = [
        'apps/api/src/teachers/dto/teachers.dto.ts',
        'apps/api/src/questions/dto/questions.dto.ts',
        'apps/api/src/pas/dto/pas.dto.ts',
        'apps/api/src/exam-configs/dto/exam-configs.dto.ts',
        'apps/api/src/proctor/dto/proctor.dto.ts',
    ];

    for (const relative of dtoFiles) {
        assert.doesNotMatch(read(relative), /\borganizationId\s*!?\s*:/, relative);
    }
});

test('SCHOOL-TRANSPORT-03: klien dan proxy tidak mengirim pemilih sekolah', () => {
    const files = [
        ...collectSourceFiles('apps/web/lib/api'),
        ...collectSourceFiles('apps/web/app/api'),
    ];

    for (const relative of files) {
        const source = read(relative);
        assert.doesNotMatch(source, /searchParams\.get\(['"]organizationId['"]\)/, relative);
        assert.doesNotMatch(source, /[?&]organizationId=/, relative);
        assert.doesNotMatch(source, /\{\s*organizationId(?:\s*[:,}])/, relative);
    }
});

test('SCHOOL-TRANSPORT-04: kontrak sesi mewajibkan tepat satu sekolah', () => {
    const shared = read('packages/shared/src/api.ts');
    const decorator = read('apps/api/src/common/decorators/current-school-id.decorator.ts');
    assert.match(shared, /organizationId: string/);
    assert.doesNotMatch(shared, /organizationIds|organizationId: string \| null/);
    assert.match(decorator, /user\?\.organizationId/);
    assert.match(decorator, /ServiceUnavailableException/);
});
