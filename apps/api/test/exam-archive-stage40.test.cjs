// Run from repository root: node apps/api/test/exam-archive-stage40.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { ExamsService } = require('../src/exams/exams.service.ts');

const user = { id: 'staff-1', isPlatformAdmin: false };
const authz = { assertExamStaff: async () => {}, assertProktorByRecord: async () => {} };

function tables(status = 'finished', attempts = []) {
    return {
        cbt_exams: [{
            id: 'exam-1', status, is_published: true,
            metadata: { preserved: true }, organization_id: 'school-1',
        }],
        cbt_exam_attempts: attempts,
    };
}

test('ARCHIVE-01: arsip menyembunyikan ujian tanpa menghapus hasil', async () => {
    const db = fixtureDb(tables('finished', [{
        id: 'attempt-1', exam_id: 'exam-1', status: 'submitted', total_score: 85,
    }]));
    const result = await new ExamsService(db, authz).setArchived(user, 'exam-1', true);

    assert.deepEqual(result, { id: 'exam-1', archived: true });
    assert.equal(db.tables.cbt_exams[0].status, 'archived');
    assert.equal(db.tables.cbt_exams[0].is_published, false);
    assert.equal(db.tables.cbt_exams[0].metadata.archive_previous_status, 'finished');
    assert.equal(db.tables.cbt_exams[0].metadata.preserved, true);
    assert.equal(db.tables.cbt_exam_attempts.length, 1);
    assert.equal(db.tables.cbt_exam_attempts[0].total_score, 85);
});

test('ARCHIVE-02: ujian dengan pengerjaan aktif tidak dapat diarsipkan', async () => {
    const db = fixtureDb(tables('active', [{
        id: 'attempt-1', exam_id: 'exam-1', status: 'in_progress',
    }]));

    await assert.rejects(
        new ExamsService(db, authz).setArchived(user, 'exam-1', true),
        /masih sedang dikerjakan/i,
    );
    assert.equal(db.tables.cbt_exams[0].status, 'active');
    assert.equal(db.tables.cbt_exams[0].is_published, true);
});

test('ARCHIVE-03: pemulihan arsip selalu kembali sebagai draft tidak terpublikasi', async () => {
    const source = tables('archived');
    source.cbt_exams[0].is_published = false;
    source.cbt_exams[0].metadata = {
        preserved: true,
        archive_previous_status: 'active',
        archive_previous_published: true,
        archived_at: '2026-09-28T00:00:00.000Z',
        archived_by: 'staff-1',
    };
    const db = fixtureDb(source);
    await new ExamsService(db, authz).setArchived(user, 'exam-1', false);

    assert.equal(db.tables.cbt_exams[0].status, 'draft');
    assert.equal(db.tables.cbt_exams[0].is_published, false);
    assert.equal(db.tables.cbt_exams[0].metadata.archive_previous_status, undefined);
    assert.equal(db.tables.cbt_exams[0].metadata.last_archived_at, '2026-09-28T00:00:00.000Z');
    assert.equal(db.tables.cbt_exams[0].metadata.preserved, true);
});

test('ARCHIVE-04: operasi arsip idempoten', async () => {
    const db = fixtureDb(tables('archived'));
    db.tables.cbt_exams[0].is_published = false;
    const before = db.writes.length;
    const result = await new ExamsService(db, authz).setArchived(user, 'exam-1', true);
    assert.deepEqual(result, { id: 'exam-1', archived: true });
    assert.equal(db.writes.length, before);
});

test('ARCHIVE-05: UI memisahkan arsip dari daftar aktif untuk semua peran', () => {
    for (const role of ['admin', 'proktor', 'guru']) {
        const source = fs.readFileSync(
            path.resolve(__dirname, `../../web/app/dashboard/${role}/exams/page.tsx`),
            'utf8',
        );
        assert.match(source, /'archived'/);
        assert.match(source, /getExamStatus\(e\) !== 'archived'/);
        assert.match(source, /setExamArchived\(exam\.id, archive\)/);
        assert.match(source, /Jawaban dan nilai tetap disimpan/);
    }
});

test('ARCHIVE-06: kontrak API dan proteksi mutasi arsip tersedia', () => {
    const controller = fs.readFileSync(
        path.resolve(__dirname, '../src/exams/exams.controller.ts'),
        'utf8',
    );
    const admin = fs.readFileSync(
        path.resolve(__dirname, '../src/proctor/exam-admin.service.ts'),
        'utf8',
    );
    assert.match(controller, /@Post\(':id\/archive'\)/);
    assert.match(admin, /Pulihkan ujian dari arsip sebelum mengubahnya/);
    assert.match(admin, /Pulihkan ujian dari arsip sebelum menerbitkannya/);
    assert.match(admin, /Pulihkan ujian dari arsip sebelum mengubah penugasan/);
});
