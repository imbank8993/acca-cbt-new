const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ExamAdminService } = require('../src/proctor/exam-admin.service.ts');

// Ujian biasa kini dapat memilih aturan skor Benar-Salah & Kategorisasi seperti folder ASAS/AM.
const ORG = '11111111-1111-4111-8111-111111111111';
const EXAM = '33333333-3333-4333-8333-333333333333';

function service(tables = {}) {
    const db = fixtureDb(tables);
    const s = Object.create(ExamAdminService.prototype);
    s.db = db;
    s.settings = { getSchoolTimeZone: async () => 'Asia/Makassar' };
    s.resolveOrganizationId = async () => ORG;
    s.assertMayUseExamType = async () => {};
    s.authz = { assertExamStaff: async () => {} };
    return { s, db };
}
const exam = (metadata = {}) => ({ id: EXAM, organization_id: ORG, metadata, exam_type: 'daily', status: 'draft', title: 'UH' });
const edit = (extra = {}) => ({ title: 'UH', examType: 'daily', duration: 60, ...extra });

test('new exams default to the official (juknis) rule and keep an explicit choice', () => {
    const { s } = service();
    assert.equal(s.buildMetadata('daily', edit(), {}).complex_scoring_rule, 'official');
    assert.equal(s.buildMetadata('daily', edit({ complexScoringRule: 'proportional' }), {}).complex_scoring_rule, 'proportional');
});

test('editing without the field keeps the stored rule, including legacy proportional exams', () => {
    const { s } = service();
    assert.equal(s.buildMetadata('daily', edit(), { complex_scoring_rule: 'proportional' }).complex_scoring_rule, 'proportional');
});

test('the rule can change while nobody has started the exam', async () => {
    const { s, db } = service({ cbt_exams: [exam()], cbt_exam_attempts: [] });
    await s.update({ id: 'staff' }, EXAM, edit({ complexScoringRule: 'proportional' }));
    assert.equal(db.tables.cbt_exams[0].metadata.complex_scoring_rule, 'proportional');
});

test('the rule is locked once a student has an attempt', async () => {
    const { s, db } = service({ cbt_exams: [exam({ complex_scoring_rule: 'official' })], cbt_exam_attempts: [{ id: 'a1', exam_id: EXAM }] });
    await assert.rejects(s.update({ id: 'staff' }, EXAM, edit({ complexScoringRule: 'proportional' })), /tidak dapat diubah karena sudah ada siswa/);
    assert.equal(db.tables.cbt_exams[0].metadata.complex_scoring_rule, 'official');
    // Mengirim aturan yang sama (formulir selalu mengirimnya) tetap boleh menyimpan bidang lain.
    await s.update({ id: 'staff' }, EXAM, edit({ title: 'UH Baru', complexScoringRule: 'official' }));
    assert.equal(db.tables.cbt_exams[0].title, 'UH Baru');
});

test('DTO only accepts the two known rules', async () => {
    require('reflect-metadata');
    const { plainToInstance } = require('class-transformer');
    const { validate } = require('class-validator');
    const { UpdateExamDto } = require('../src/proctor/dto/proctor.dto.ts');
    const errors = await validate(plainToInstance(UpdateExamDto, edit({ complexScoringRule: 'partial' })));
    assert.ok(errors.some(error => error.property === 'complexScoringRule'));
    const ok = await validate(plainToInstance(UpdateExamDto, edit({ complexScoringRule: 'official' })));
    assert.ok(!ok.some(error => error.property === 'complexScoringRule'));
});
