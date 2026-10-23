const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { sanitizeDatabaseDetail } = require('../src/common/filters/all-exceptions.filter.ts');

test('raw database errors never reach the user; missing schema names the migration as the cause', () => {
    const missingColumn = 'Invalid `prisma.$queryRawUnsafe()` invocation: Raw query failed. Code: `42703`. Message: `column "committee_chair_name" of relation "cbt_pas_periods" does not exist`';
    assert.match(sanitizeDatabaseDetail(missingColumn), /migrasi database terbaru/);
    assert.match(sanitizeDatabaseDetail('relation "cbt_new_table" does not exist'), /migrasi database terbaru/);
    const constraint = 'Raw query failed. Code: `23514`. Message: `new row violates check constraint "x"`';
    assert.equal(sanitizeDatabaseDetail(constraint), 'Permintaan belum dapat diproses oleh database. Periksa isian lalu coba lagi.');
    for (const value of [missingColumn, constraint]) assert.doesNotMatch(String(sanitizeDatabaseDetail(value)), /prisma|cbt_|Code:/);
    // Messages written for users, and validation arrays, pass through unchanged.
    assert.equal(sanitizeDatabaseDetail('Nama Ketua Panitia wajib diisi.'), 'Nama Ketua Panitia wajib diisi.');
    assert.deepEqual(sanitizeDatabaseDetail(['name must be a string']), ['name must be a string']);
});

test('the ASAS/ASAT folder form uses the shared date picker for both period dates', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/components/exams/CreateExamModal.tsx'), 'utf8');
    assert.doesNotMatch(source, /type="date"/);
    assert.match(source, /<DatePicker\s+required\s+title="Tanggal mulai periode"[\s\S]*?max=\{formData\.pasEndDate \|\| undefined\}/);
    assert.match(source, /<DatePicker\s+required\s+title="Tanggal selesai periode"\s+min=\{formData\.pasStartDate \|\| undefined\}/);
});
