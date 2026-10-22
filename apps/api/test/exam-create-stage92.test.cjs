const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ExamAdminService } = require('../src/proctor/exam-admin.service.ts');

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
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
const base = (extra = {}) => ({ title: 'UTS', examType: 'daily', duration: 60, clientRequestId: 'x', ...extra });
const noInsert = db => assert.equal(db.writes.filter(w => w.table === 'cbt_exams').length, 0);

test('create rejects a question bank from another school', async () => {
    const { s, db } = service({ cbt_question_banks: [{ id: 'bank-b', organization_id: OTHER, is_published: true }] });
    await assert.rejects(s.create({ id: 'teacher' }, ORG, base({ questionBankId: 'bank-b' })), /tidak ditemukan di sekolah ini/);
    noInsert(db);
});

test('create rejects a whitespace-only title', async () => {
    const { s, db } = service();
    await assert.rejects(s.create({ id: 'teacher' }, ORG, base({ title: '   ' })), /Judul ujian wajib diisi/);
    noInsert(db);
});

test('create rejects a window that ends before it starts', async () => {
    const { s, db } = service();
    await assert.rejects(s.create({ id: 'teacher' }, ORG, base({
        startTime: '2026-11-01T10:00', endTime: '2026-11-01T09:00',
    })), /lebih lambat dari waktu mulai/);
    noInsert(db);
});

test('create rejects SVG and unknown assignment upload types', async () => {
    const { s } = service();
    for (const allowedFileTypes of [['pdf', 'svg'], ['exe'], ['html']]) {
        await assert.rejects(s.create({ id: 'teacher' }, ORG, base({ examType: 'assignment', allowedFileTypes })), /Jenis file tidak didukung/);
    }
});

test('scoring types are de-duplicated and an empty selection falls back to classical', () => {
    const { s } = service();
    const dto = base({ scoringType: 'classical,irt_2pl,irt_2pl', allowedFileTypes: ['.PDF', 'pdf'] });
    s.normalizeExamInput(dto);
    assert.equal(dto.scoringType, 'classical,irt_2pl');
    assert.deepEqual(dto.allowedFileTypes, ['pdf']);
    const empty = base({ scoringType: '' });
    s.normalizeExamInput(empty);
    assert.equal(empty.scoringType, 'classical');
});

test('publishing an exam whose banks hold no questions is refused', async () => {
    const { s, db } = service({
        cbt_exams: [{ id: EXAM, metadata: {}, status: 'draft', exam_type: 'daily', question_bank_id: 'bank-a', is_published: false }],
        cbt_exam_question_sources: [], cbt_bank_questions: [],
        cbt_exam_targets: [{ exam_id: EXAM, class_id: 'c' }],
    });
    await assert.rejects(s.setPublished({ id: 'staff' }, EXAM, true), /belum memiliki soal/);
    assert.equal(db.tables.cbt_exams[0].is_published, false);

    db.tables.cbt_bank_questions.push({ id: 'q1', bank_id: 'bank-a' });
    await s.setPublished({ id: 'staff' }, EXAM, true);
    assert.equal(db.tables.cbt_exams[0].is_published, true);
});

test('an assignment without a question bank can still be published', async () => {
    const { s, db } = service({
        cbt_exams: [{ id: EXAM, metadata: { require_bank: false }, status: 'draft', exam_type: 'assignment', question_bank_id: null }],
        cbt_exam_question_sources: [], cbt_bank_questions: [],
        cbt_exam_targets: [{ exam_id: EXAM, class_id: 'c' }],
    });
    await s.setPublished({ id: 'staff' }, EXAM, true);
    assert.equal(db.tables.cbt_exams[0].is_published, true);
});

test('editing can clear the description and trims the title', async () => {
    const { s, db } = service({
        cbt_exams: [{ id: EXAM, organization_id: ORG, metadata: {}, exam_type: 'daily', status: 'draft', title: 'Lama', description: 'Deskripsi lama' }],
    });
    await s.update({ id: 'staff' }, EXAM, { title: '  UTS Baru  ', examType: 'daily', duration: 60 });
    assert.equal(db.tables.cbt_exams[0].title, 'UTS Baru');
    assert.equal(db.tables.cbt_exams[0].description, null);
});

test('DTO rejects out-of-range duration, unknown scoring types and oversized titles', async () => {
    require('reflect-metadata');
    const { plainToInstance } = require('class-transformer');
    const { validate } = require('class-validator');
    const { CreateExamDto } = require('../src/proctor/dto/proctor.dto.ts');
    const ok = { title: 'UTS', duration: 90, clientRequestId: '44444444-4444-4444-8444-444444444444', scoringType: 'classical,irt_2pl' };
    const fields = async extra => (await validate(plainToInstance(CreateExamDto, { ...ok, ...extra }))).map(e => e.property);
    assert.deepEqual(await fields({}), []);
    assert.deepEqual(await fields({ scoringType: '' }), []);
    assert.deepEqual(await fields({ duration: 0 }), []); // tugas tanpa bank soal
    for (const duration of [2000, 1.5, -5]) assert.deepEqual(await fields({ duration }), ['duration']);
    for (const scoringType of ['irt_9pl', 'classical,,irt_2pl', 'classical;drop']) assert.deepEqual(await fields({ scoringType }), ['scoringType']);
    assert.deepEqual(await fields({ title: 'x'.repeat(201) }), ['title']);
});
