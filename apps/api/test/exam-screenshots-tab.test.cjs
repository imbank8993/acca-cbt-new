const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
require('reflect-metadata');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { fixtureDb } = require('./fixture-db.cjs');
const { ExamScreenshotsService } = require('../src/proctoring/exam-screenshots.service.ts');
const { DeleteScreenshotsDto } = require('../src/proctoring/exam-screenshots.controller.ts');

const later = new Date(Date.now() + 7 * 86_400_000).toISOString();
const earlier = new Date(Date.now() - 86_400_000).toISOString();
const shot = (id, attempt, created, extra = {}) => ({ id, attempt_id: attempt, object_key: `evidence/${id}`, event_type: 'tab_switch',
    byte_size: 1000, created_at: created, expires_at: later, deleted_at: null, ...extra });

/**
 * Dua peserta (ruang A: student, ruang B: other) dengan screenshot masing-masing.
 * Pengawas ruang A (`guard`) hanya boleh melihat peserta ruang A.
 */
function fixture() {
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', organization_id: 'school', metadata: { screenshot_enabled: true } }],
        cbt_exam_attempts: [
            { id: 'attempt-a', user_id: 'student', exam_id: 'exam', status: 'in_progress' },
            { id: 'attempt-b', user_id: 'other', exam_id: 'exam', status: 'submitted' },
            { id: 'attempt-x', user_id: 'student', exam_id: 'other-exam', status: 'in_progress' },
        ],
        cbt_profiles: [{ id: 'student', full_name: 'Siti', identity_number: '001' }, { id: 'other', full_name: 'Budi', identity_number: '002' }],
        cbt_exam_screenshots: [
            shot('s1', 'attempt-a', '2026-11-19T07:00:00.000Z'),
            shot('s2', 'attempt-b', '2026-11-19T07:05:00.000Z'),
            shot('s3', 'attempt-a', '2026-11-19T06:00:00.000Z', { object_key: null, deleted_at: earlier }),
            shot('sx', 'attempt-x', '2026-11-19T07:10:00.000Z'),
        ],
    });
    const images = new Map([['evidence/s1', 'a'], ['evidence/s2', 'b'], ['evidence/sx', 'x']]);
    const storage = { status: () => ({ configured: true }), deleteObject: async key => { images.delete(key); return { success: true }; } };
    const roles = { proktor: true, admin: true };
    const authz = {
        assertExamMonitoring: async (user, examId) => {
            if (user.id === 'outside') throw Object.assign(new Error('forbidden'), { getStatus: () => 403 });
            if (user.id === 'guard') return ['student'];
            if (examId !== 'exam' && user.id !== 'proktor') throw Object.assign(new Error('forbidden'), { getStatus: () => 403 });
            return undefined;
        },
        assertProktor: async user => { if (!roles[user.id]) throw new Error('forbidden'); },
    };
    const service = new ExamScreenshotsService(db, authz, storage, { get: () => undefined });
    return { db, images, service };
}

test('exam screenshot tab lists every participant newest first with names, scoped to the exam', async () => {
    const { service } = fixture();
    const rows = await service.listForExam({ id: 'proktor' }, 'exam');
    assert.deepEqual(rows.map(row => row.id), ['s2', 's1', 's3'], 'ujian lain (sx) tidak ikut');
    assert.deepEqual(rows.map(row => row.student_name), ['Budi', 'Siti', 'Siti']);
    assert.deepEqual(rows.map(row => row.available), [true, true, false]);
    assert.equal(rows[0].object_key, undefined, 'kunci objek penyimpanan tidak dikirim ke browser');
});

test('room invigilators only see their own room; staff without monitoring rights are refused', async () => {
    const { service } = fixture();
    assert.deepEqual((await service.listForExam({ id: 'guard' }, 'exam')).map(row => row.id), ['s1', 's3']);
    await assert.rejects(service.listForExam({ id: 'outside' }, 'exam'), e => e.getStatus() === 403);
});

test('only Proktor/Admin may delete from the tab; guru teachers can only view', async () => {
    const { service } = fixture();
    assert.equal(await service.canDeleteForExam({ id: 'guru' }, 'exam'), false);
    assert.equal(await service.canDeleteForExam({ id: 'proktor' }, 'exam'), true);
    assert.equal(await service.canDeleteForExam({ id: 'proktor' }, 'missing'), false);
});

test('bulk delete removes allowed images, keeps the event rows, and reports refused ones per item', async () => {
    const { db, images, service } = fixture();
    const refused = await service.removeMany({ id: 'guru' }, ['s1', 's2']);
    assert.equal(refused.deleted, 0);
    assert.equal(refused.failed.length, 2);
    assert.equal(images.size, 3, 'guru tidak menghapus apa pun');

    const result = await service.removeMany({ id: 'proktor' }, ['s1', 's2', 's1', '00000000-0000-4000-8000-000000000000']);
    assert.equal(result.deleted, 2, 'id ganda hanya diproses sekali');
    assert.equal(result.failed.length, 1);
    assert.ok(!images.has('evidence/s1') && !images.has('evidence/s2'));
    assert.ok(images.has('evidence/sx'), 'gambar yang tidak dipilih tetap ada');
    for (const id of ['s1', 's2']) {
        const row = db.tables.cbt_exam_screenshots.find(item => item.id === id);
        assert.equal(row.object_key, null);
        assert.ok(row.deleted_at, 'baris kejadian tetap ada sebagai jejak');
    }
});

test('bulk delete request accepts 1 to 200 UUIDs only', async () => {
    const errors = async ids => (await validate(plainToInstance(DeleteScreenshotsDto, { ids }))).length;
    assert.equal(await errors(['00000000-0000-4000-8000-000000000000']), 0);
    assert.ok(await errors([]) > 0);
    assert.ok(await errors(['not-a-uuid']) > 0);
    assert.ok(await errors(Array.from({ length: 201 }, () => '00000000-0000-4000-8000-000000000000')) > 0);
    assert.ok(await errors('s1') > 0);
});
