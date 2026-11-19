const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { pickCurrentClass } = require('../src/students/student-class.ts');
const { StudentsService } = require('../src/students/students.service.ts');

// Siswa naik kelas: masih tercatat di kelas lama (X Al Razi 2025/2026) dan kelas baru.
const oldClass = { id: 'x-alrazi', name: 'X Al Razi', organization_id: 'school', school_year: '2025/2026' };
const newClass = { id: 'xi-alrazi', name: 'XI Al Razi', organization_id: 'school', school_year: '2026/2027' };

test('a promoted student is shown in the class of the active school year, not the old one', () => {
    // Kelas lama sengaja di urutan pertama: dulu baris pertama yang dipilih.
    assert.equal(pickCurrentClass([oldClass, newClass], { organizationId: 'school', activeYears: ['2026/2027'] }).name, 'XI Al Razi');
});

test('without an active-year setting the newest school year wins', () => {
    assert.equal(pickCurrentClass([oldClass, newClass], { organizationId: 'school' }).name, 'XI Al Razi');
    assert.equal(pickCurrentClass([newClass, oldClass]).name, 'XI Al Razi');
    // Tahun ajaran kosong dianggap paling lama.
    assert.equal(pickCurrentClass([{ id: 'n', name: 'Tanpa Tahun' }, newClass]).name, 'XI Al Razi');
});

test('the class targeted by the exam is preferred, e.g. a make-up exam for last year', () => {
    assert.equal(pickCurrentClass([oldClass, newClass], { organizationId: 'school', targetClassIds: ['x-alrazi'], activeYears: ['2026/2027'] }).name, 'X Al Razi');
});

test('classes of the exam school are preferred and unnamed classes ignored', () => {
    const otherSchool = { id: 'o', name: 'XII Lain', organization_id: 'other', school_year: '2027/2028' };
    assert.equal(pickCurrentClass([otherSchool, oldClass, newClass], { organizationId: 'school' }).name, 'XI Al Razi');
    assert.equal(pickCurrentClass([{ id: 'blank', name: '  ', school_year: '2030/2031' }, oldClass]).name, 'X Al Razi');
    assert.equal(pickCurrentClass([]), null);
});

test('exam page profile reads the current class from memberships, active years and exam targets', async () => {
    const db = fixtureDb({
        cbt_class_members: [{ user_id: 'student', class_id: 'x-alrazi' }, { user_id: 'student', class_id: 'xi-alrazi' }],
        cbt_classes: [oldClass, newClass],
        school_years: [{ organization_id: 'school', year: '2026/2027', is_active: true }, { organization_id: 'school', year: '2025/2026', is_active: false }],
        master_tahun_ajaran: [],
        cbt_exam_targets: [{ exam_id: 'exam-now', class_id: 'xi-alrazi' }, { exam_id: 'exam-old', class_id: 'x-alrazi' }],
    });
    const service = new StudentsService(db);
    assert.equal(await service.regularClassName('student', 'school', 'exam-now'), 'XI Al Razi');
    assert.equal(await service.regularClassName('student', 'school', 'exam-old'), 'X Al Razi');
    assert.equal(await service.regularClassName('student', 'school', 'exam-without-targets'), 'XI Al Razi');
    // Satu kelas saja: tidak perlu membaca tahun ajaran atau sasaran ujian.
    db.tables.cbt_class_members = [{ user_id: 'student', class_id: 'xi-alrazi' }];
    const before = db.queries.length;
    assert.equal(await service.regularClassName('student', 'school', 'exam-now'), 'XI Al Razi');
    assert.deepEqual(db.queries.slice(before).map(query => query.table), ['cbt_class_members', 'cbt_classes']);
});
