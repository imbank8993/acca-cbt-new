const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { gradeFromClassName, readCurrentClass } = require('../src/students/student-class.ts');
const { subjectPalette } = require('../../web/lib/learning-subject-colors.ts');

test('gradeFromClassName: tingkat dari nama kelas romawi atau angka', () => {
    assert.equal(gradeFromClassName('XI D'), '11');
    assert.equal(gradeFromClassName('X Al Razi'), '10');
    assert.equal(gradeFromClassName('XII-IPA 1'), '12');
    assert.equal(gradeFromClassName('10 A'), '10');
    assert.equal(gradeFromClassName('Kelas Unggulan'), null);
    assert.equal(gradeFromClassName(null), null);
});

function fakeDb(tables) {
    return { from(table) {
        const rows = tables[table] || [];
        let result = rows;
        const chain = {
            select() { return chain; },
            eq(column, value) { result = result.filter(row => row[column] === value); return chain; },
            in(column, values) { result = result.filter(row => values.includes(row[column])); return chain; },
            then(resolve) { resolve({ data: result, error: null }); },
        };
        return chain;
    } };
}

test('readCurrentClass: kelas tahun ajaran aktif, bukan kelas tahun lalu', async () => {
    const db = fakeDb({
        cbt_class_members: [{ user_id: 's1', class_id: 'old' }, { user_id: 's1', class_id: 'new' }],
        cbt_classes: [{ id: 'old', name: 'X Al Razi', organization_id: 'org', school_year: '2025/2026' },
            { id: 'new', name: 'XI D', organization_id: 'org', school_year: '2026/2027' }],
        school_years: [{ organization_id: 'org', year: '2026/2027', is_active: true }],
        master_tahun_ajaran: [],
    });
    const current = await readCurrentClass(db, 's1', 'org');
    assert.equal(current.name, 'XI D');
    assert.equal(gradeFromClassName(current.name), '11');
    assert.equal(await readCurrentClass(db, 'tanpa-kelas', 'org'), null);
});

test('learning list returns the student grade; page shows own class first and colors cards per subject', () => {
    const service = fs.readFileSync(path.resolve(__dirname, '../src/learning/learning.service.ts'), 'utf8');
    assert.match(service, /const myClass = canManage \? null : await readCurrentClass\(this\.db, user\.id, org\)/);
    assert.match(service, /return \{ myGrade, myClassName:/);
    const page = fs.readFileSync(path.resolve(__dirname, '../../web/app/dashboard/learning/page.tsx'), 'utf8');
    assert.doesNotMatch(page, /lc-tone-\$\{index/, 'warna kartu tidak lagi bergantung pada urutan');
    assert.match(page, /const grade = chosenGrade \?\? ownGrade \?\? 'all';/);
    assert.match(page, /· kelas saya/);
    // Semua BAB satu mapel memakai gradasi yang sama; mapel berbeda yang umum berbeda warna.
    assert.equal(subjectPalette('Matematika').id, subjectPalette('  matematika ').id);
    const common = ['Matematika', 'Fisika', 'Kimia', 'Biologi', 'Bahasa Indonesia', 'Bahasa Inggris', 'Informatika'].map(name => subjectPalette(name).id);
    assert.equal(new Set(common).size, common.length);
    assert.equal(subjectPalette('Seni Budaya').id, subjectPalette('Seni Budaya').id);
});
