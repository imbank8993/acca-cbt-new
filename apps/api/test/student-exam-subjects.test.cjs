const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { examSubjectNames } = require('../src/common/exam-subjects.ts');
const { StudentsService } = require('../src/students/students.service.ts');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('folder exams get their subject from subject_id, the bank, or an extra source bank', async () => {
    const db = fixtureDb({
        cbt_subjects: [{ id: id(1), name: 'Fisika' }],
        cbt_question_banks: [{ id: id(10), subject: 'Kimia' }, { id: id(11), subject: 'Biologi' }],
        cbt_exam_question_sources: [{ exam_id: id(23), bank_id: id(11) }],
    });
    const names = await examSubjectNames(db, [
        { id: id(21), subject_id: id(1), question_bank_id: id(10) },
        { id: id(22), subject_id: null, question_bank_id: id(10) },
        { id: id(23), subject_id: null, question_bank_id: null },
        { id: id(24), subject_id: null, question_bank_id: null },
    ]);
    assert.equal(names.get(id(21)), 'Fisika', 'subject_id diutamakan');
    assert.equal(names.get(id(22)), 'Kimia');
    assert.equal(names.get(id(23)), 'Biologi');
    assert.equal(names.has(id(24)), false);
});

test('student results list carries the subject for each folder exam', async () => {
    const exam = (n, bank) => ({ id: id(n), title: 'ASAS Ganjil 2026/2027', duration_minutes: 90, show_results: true,
        scoring_type: 'classical', question_bank_id: bank, subject_id: null, metadata: {} });
    const db = fixtureDb({
        cbt_question_banks: [{ id: id(10), subject: 'Fisika' }, { id: id(11), subject: 'Matematika' }],
        cbt_exam_attempts: [
            { id: 'a1', user_id: 'student', status: 'submitted', total_score: 91.6, finished_at: '2026-11-18T02:56:00Z', metadata: {}, exams: exam(31, id(10)) },
            { id: 'a2', user_id: 'student', status: 'submitted', total_score: 60, finished_at: '2026-11-18T01:00:00Z', metadata: {}, exams: exam(32, id(11)) },
        ],
    });
    const rows = await new StudentsService(db).listResults({ id: 'student' });
    assert.deepEqual(rows.map(row => row.exams.subject), ['Fisika', 'Matematika']);
});

test('student dashboard, schedule and results pages show the subject and the bank cover', () => {
    const web = file => fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');
    assert.match(web('app/dashboard/siswa/page.tsx'), /\{exam\.subject && /);
    assert.match(web('app/dashboard/siswa/page.tsx'), /res\.exams\?\.subject \? `\$\{res\.exams\.subject\} · `/);
    const schedule = web('app/dashboard/siswa/schedule/page.tsx');
    assert.equal((schedule.match(/<StudentExamCover cover=\{exam\.cover_url\}/g) || []).length, 3);
    assert.equal((schedule.match(/<SubjectPill subject=\{exam\.subject\} \/>/g) || []).length, 3);
    // Mode gelap: tidak ada lagi warna terang khusus tanpa pasangan gelap.
    assert.doesNotMatch(schedule, /bg-\[#EFF5FD\]/);
    const results = web('app/dashboard/siswa/results/page.tsx');
    assert.match(results, /<StudentExamCover cover=\{attempt\.exams\?\.cover_url\}/);
    assert.match(results, /<SubjectPill subject=\{attempt\.exams\?\.subject\} \/>/);
});

test('students may open a bank cover only when the bank is used by an exam assigned to them', async () => {
    const { StorageAccessService } = require('../src/storage/storage-access.service.ts');
    const { StorageService } = require('../src/storage/storage.service.ts');
    const cover = 'users/teacher/banks/cover.webp';
    const db = fixtureDb({
        cbt_organization_members: [{ user_id: 'student', organization_id: 'school', is_active: true }],
        cbt_question_banks: [{ id: id(10), organization_id: 'school', image_url: `/api/storage/file/${cover}` },
            { id: id(11), organization_id: 'school', image_url: '/api/storage/file/users/teacher/banks/other.webp' }],
        cbt_exams: [{ id: id(40), organization_id: 'school', is_published: true, question_bank_id: id(10), metadata: { is_public: true } },
            { id: id(41), organization_id: 'school', is_published: false, question_bank_id: id(11), metadata: { is_public: true } }],
        cbt_exam_question_sources: [], cbt_exam_attempts: [],
    }, [], { now: '2026-11-18T02:00:00Z' });
    const storage = Object.create(StorageService.prototype);
    Object.assign(storage, { publicUrl: 'https://files.example.test', bucket: 'bucket', accountId: 'account' });
    const access = new StorageAccessService(db, {}, storage);
    const user = { id: 'student', roles: ['SISWA'] };
    await access.assertRead(user, cover);
    await assert.rejects(access.assertRead(user, 'users/teacher/banks/other.webp'), e => e.getStatus?.() === 403, 'ujian belum terbit');
    await assert.rejects(access.assertRead(user, 'users/teacher/banks/unknown.webp'), e => e.getStatus?.() === 403);
});

test('student schedule list carries subject and cover', async () => {
    const db = fixtureDb({
        cbt_organization_members: [{ user_id: 'student', organization_id: 'school', is_active: true }],
        cbt_question_banks: [{ id: id(10), subject: 'Fisika', image_url: '/api/storage/file/users/t/banks/fisika.webp' }],
        cbt_exams: [{ id: id(50), organization_id: 'school', title: 'ASAS Ganjil 2026/2027', is_published: true,
            question_bank_id: id(10), subject_id: null, start_time: '2026-11-19T00:00:00Z', metadata: { is_public: true } }],
        cbt_exam_question_sources: [], cbt_exam_attempts: [],
    }, [], { now: '2026-11-18T02:00:00Z' });
    const [exam] = await new StudentsService(db).listExams({ id: 'student' });
    assert.equal(exam.subject, 'Fisika');
    assert.equal(exam.cover_url, '/api/storage/file/users/t/banks/fisika.webp');
});

test('schedule page does not auto-refresh and has no manual refresh button; result page shows the cover', () => {
    const web = file => fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');
    const schedule = web('app/dashboard/siswa/schedule/page.tsx');
    assert.doesNotMatch(schedule, /useAutoRefresh/);
    assert.doesNotMatch(schedule, /Perbarui Jadwal/);
    const detail = web('app/dashboard/siswa/results/[attemptId]/page.tsx');
    assert.match(detail, /<StudentExamCover cover=\{attempt\.exams\?\.cover_url\}/);
    assert.match(detail, /<SubjectPill subject=\{attempt\.exams\?\.subject\} \/>/);
});
