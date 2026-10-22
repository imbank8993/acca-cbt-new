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

function assignFixture(extra = {}) {
    return service({
        cbt_exams: [{ id: EXAM, organization_id: ORG, status: 'active', metadata: {} }],
        cbt_classes: [{ id: 'kelas-a', organization_id: ORG, school_year: '2026/2027' }, { id: 'kelas-b', organization_id: ORG, school_year: '2026/2027' }],
        cbt_additional_classes: [{ id: 'tambahan', organization_id: ORG }],
        master_tahun_ajaran: [{ tahun_ajaran: '2026/2027', is_active: true }],
        cbt_organization_members: [{ organization_id: ORG, user_id: 'siswa-a', is_active: true }, { organization_id: ORG, user_id: 'siswa-b', is_active: true }],
        cbt_class_members: [{ class_id: 'kelas-a', user_id: 'siswa-a' }, { class_id: 'kelas-b', user_id: 'siswa-b' }],
        cbt_additional_class_members: [{ class_id: 'tambahan', user_id: 'siswa-a' }],
        cbt_exam_targets: [{ exam_id: EXAM, class_id: 'kelas-a' }, { exam_id: EXAM, class_id: 'kelas-b' }],
        cbt_exam_participants: [],
        cbt_exam_attempts: [{ exam_id: EXAM, user_id: 'siswa-a', status: 'in_progress' }, { exam_id: EXAM, user_id: 'siswa-b', status: 'submitted' }],
        cbt_profiles: [{ id: 'siswa-a', full_name: 'Siswa A' }],
        ...extra,
    });
}

test('removing the class of a student who is still working is refused and changes nothing', async () => {
    const { s, db } = assignFixture();
    await assert.rejects(s.assign({ id: 'staff' }, EXAM, ['kelas-b'], [], false), /1 siswa sedang mengerjakan.*Siswa A/);
    assert.equal(db.tables.cbt_exam_targets.length, 2);
});

test('removing a class whose students have all finished is allowed', async () => {
    const { s, db } = assignFixture();
    await s.assign({ id: 'staff' }, EXAM, ['kelas-a'], [], false);
    assert.deepEqual(db.tables.cbt_exam_targets.map(t => t.class_id), ['kelas-a']);
});

test('a working student stays covered by an individual selection or another class', async () => {
    for (const [classIds, participants] of [
        [[], [{ userId: 'siswa-a', classId: 'kelas-a' }]],
        [['tambahan'], []],
    ]) {
        const { s } = assignFixture();
        await s.assign({ id: 'staff' }, EXAM, classIds, participants, false);
    }
});

test('public exams may drop their class targets while students are working', async () => {
    const { s, db } = assignFixture({ cbt_exams: [{ id: EXAM, organization_id: ORG, status: 'active', metadata: { is_public: true } }] });
    await s.assign({ id: 'staff' }, EXAM, [], [], false);
    assert.equal(db.tables.cbt_exam_targets.length, 0);
});
