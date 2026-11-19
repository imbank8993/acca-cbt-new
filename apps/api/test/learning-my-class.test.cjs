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

test('readCurrentClass: kelas wali (Reguler) mengalahkan UTBK/Tambahan di tahun ajaran yang sama', async () => {
    // Kasus nyata: siswa XII D juga anggota UTBK A (2026/2027) dan masih tercatat di XI D (2025/2026).
    const db = fakeDb({
        cbt_class_members: [{ user_id: 's1', class_id: 'xi' }, { user_id: 's1', class_id: 'utbk' }, { user_id: 's1', class_id: 'xii' }],
        cbt_classes: [{ id: 'xi', name: 'XI D', organization_id: 'org', school_year: '2025/2026', program: 'Reguler' },
            { id: 'utbk', name: 'UTBK A', organization_id: 'org', school_year: '2026/2027', program: 'UTBK' },
            { id: 'xii', name: 'XII D', organization_id: 'org', school_year: '2026/2027', program: 'Reguler' }],
        school_years: [],
        master_tahun_ajaran: [{ tahun_ajaran: '2026/2027', is_active: true }],
    });
    const current = await readCurrentClass(db, 's1', 'org');
    assert.equal(current.name, 'XII D');
    assert.equal(gradeFromClassName(current.name), '12');
});

test('pickCurrentClass: kelas tanpa program (data lama) dipakai sebelum Peminatan/UTBK, Reguler paling utama', () => {
    const { pickCurrentClass } = require('../src/students/student-class.ts');
    const legacy = { id: 'a', name: 'XII B', school_year: '2026/2027', program: null };
    const elective = { id: 'b', name: 'Fisika XII', school_year: '2026/2027', program: 'Peminatan' };
    const utbk = { id: 'c', name: 'UTBK A', school_year: '2026/2027', program: 'UTBK' };
    assert.equal(pickCurrentClass([utbk, elective, legacy]).id, 'a');
    assert.equal(pickCurrentClass([utbk, { ...legacy, program: 'Reguler' }, elective]).id, 'a');
    assert.equal(pickCurrentClass([utbk]).id, 'c', 'satu-satunya kelas tetap dipakai');
    // Ujian yang menyasar kelas UTBK tetap menampilkan kelas wali di kepala ujian.
    assert.equal(pickCurrentClass([utbk, { ...legacy, program: 'Reguler' }], { targetClassIds: ['c'] }).id, 'a');
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
