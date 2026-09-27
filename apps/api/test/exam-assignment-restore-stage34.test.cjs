// Run from repository root: node apps/api/test/exam-assignment-restore-stage34.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { ExamAdminService } = require('../src/proctor/exam-admin.service.ts');

const root = path.resolve(__dirname, '../../..');
const user = { id: 'proctor-1', isPlatformAdmin: false };
const authz = { assertExamStaff: async () => {} };

test('RESTORE-01: kelas asal tersimpan mengalahkan urutan riwayat keanggotaan', async () => {
    const db = fixtureDb({
        cbt_exam_targets: [],
        cbt_exam_participants: [{
            exam_id: 'exam-1', user_id: 'student-1',
            regular_class_id: 'current-class', additional_class_id: null,
        }],
        // Urutan ini sengaja menempatkan kelas lama lebih dulu. Implementasi
        // lama mengambil baris pertama dan mengembalikan kelas yang salah.
        cbt_class_members: [
            { user_id: 'student-1', class_id: 'old-class' },
            { user_id: 'student-1', class_id: 'current-class' },
        ],
    });
    const service = new ExamAdminService(db, authz, {});

    const result = await service.listAssignments(user, ['exam-1']);
    assert.deepEqual(result.participants, [{
        exam_id: 'exam-1', user_id: 'student-1', class_id: 'current-class',
    }]);
    assert.equal(db.queries.some((query) => query.table === 'cbt_class_members'), false);
});

test('RESTORE-02: kelas tambahan asal peserta dipulihkan tepat', async () => {
    const db = fixtureDb({
        cbt_exam_targets: [],
        cbt_exam_participants: [{
            exam_id: 'exam-1', user_id: 'student-1',
            regular_class_id: null, additional_class_id: 'extra-1',
        }],
    });
    const service = new ExamAdminService(db, authz, {});
    const result = await service.listAssignments(user, ['exam-1']);
    assert.equal(result.participants[0].class_id, 'extra-1');
});

test('RESTORE-03: peserta wajib benar-benar menjadi anggota kelas sumber', async () => {
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam-1', organization_id: 'school-1', status: 'draft' }],
        cbt_classes: [{ id: 'class-1', organization_id: 'school-1', school_year: '2026/2027' }],
        cbt_additional_classes: [],
        master_tahun_ajaran: [{ tahun_ajaran: '2026/2027', is_active: true }],
        cbt_organization_members: [{
            organization_id: 'school-1', user_id: 'student-1', is_active: true,
        }],
        cbt_class_members: [],
        cbt_additional_class_members: [],
        cbt_exam_targets: [{ id: 'old-target', exam_id: 'exam-1', class_id: 'class-1' }],
        cbt_exam_participants: [],
    });
    const service = new ExamAdminService(db, authz, {});

    await assert.rejects(
        service.assign(
            user,
            'exam-1',
            [],
            [{ userId: 'student-1', classId: 'class-1' }],
            false,
        ),
        /bukan anggota kelas/i,
    );
    assert.equal(db.tables.cbt_exam_targets[0].id, 'old-target');
});

test('RESTORE-04: kontrak browser mengirim pasangan siswa dan kelas pada tiga peran', () => {
    const helper = fs.readFileSync(path.join(root, 'apps/web/lib/api/proctor.ts'), 'utf8');
    assert.match(helper, /participantAssignments: \{ userId: string; classId: string \}\[\]/);
    assert.match(helper, /\{ classIds, participantAssignments, activate \}/);
    assert.doesNotMatch(helper, /\{ classIds, userIds, activate \}/);

    for (const role of ['admin', 'guru', 'proktor']) {
        const page = fs.readFileSync(
            path.join(root, `apps/web/app/dashboard/${role}/exams/page.tsx`),
            'utf8',
        );
        assert.match(page, /participantAssignments\.push/);
        assert.match(page, /classId: clsId/);
    }
});

test('RESTORE-05: migrasi menambah dua FK sumber dan batas satu kelas', () => {
    const migration = fs.readFileSync(
        path.join(root, 'database/migrations/20260927_06_exam_participant_class_source.sql'),
        'utf8',
    );
    assert.match(migration, /ADD COLUMN IF NOT EXISTS regular_class_id uuid/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS additional_class_id uuid/);
    assert.match(migration, /cbt_exam_participants_regular_class_fk/);
    assert.match(migration, /cbt_exam_participants_additional_class_fk/);
    assert.match(migration, /num_nonnulls\(regular_class_id, additional_class_id\) <= 1/);
});
