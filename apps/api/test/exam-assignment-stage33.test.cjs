// Run from repository root: node apps/api/test/exam-assignment-stage33.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { ExamAdminService } = require('../src/proctor/exam-admin.service.ts');

const user = { id: 'proctor-1', isPlatformAdmin: false };
const authz = { assertExamStaff: async () => {} };
const roles = {};

function tables() {
    return {
        cbt_exams: [{ id: 'exam-1', organization_id: 'school-1', status: 'draft' }],
        cbt_classes: [{
            id: 'class-1', organization_id: 'school-1', school_year: '2026/2027',
        }],
        cbt_additional_classes: [{ id: 'extra-1', organization_id: 'school-1' }],
        master_tahun_ajaran: [{ tahun_ajaran: '2026/2027', is_active: true }],
        cbt_organization_members: [{
            id: 'member-1', organization_id: 'school-1', user_id: 'student-1', is_active: true,
        }],
        cbt_class_members: [{ class_id: 'class-1', user_id: 'student-1' }],
        cbt_additional_class_members: [{ class_id: 'extra-1', user_id: 'student-1' }],
        cbt_exam_targets: [{ id: 'old-target', exam_id: 'exam-1', class_id: 'old-class' }],
        cbt_exam_participants: [{
            id: 'old-participant', exam_id: 'exam-1', user_id: 'old-student',
        }],
    };
}

test('ASSIGN-01: target tervalidasi diganti atomik dan ID ganda dibuang', async () => {
    const db = fixtureDb(tables());
    let lockCalls = 0;
    let lockArguments;
    const originalRaw = db.raw;
    db.raw = async (...args) => {
        if (/FOR UPDATE/i.test(args[0])) {
            lockCalls++;
            lockArguments = args.slice(1);
        }
        return originalRaw(...args);
    };
    const service = new ExamAdminService(db, authz, roles);

    const result = await service.assign(
        user,
        'exam-1',
        ['class-1', 'extra-1', 'class-1'],
        [
            { userId: 'student-1', classId: 'class-1' },
            { userId: 'student-1', classId: 'class-1' },
        ],
        true,
    );

    assert.deepEqual(result, { examId: 'exam-1', classes: 2, participants: 1 });
    assert.equal(lockCalls, 1);
    assert.deepEqual(lockArguments, ['exam-1']);
    assert.deepEqual(
        db.tables.cbt_exam_targets.map((row) => [row.class_id, row.additional_class_id]),
        [['class-1', undefined], [undefined, 'extra-1']],
    );
    assert.deepEqual(db.tables.cbt_exam_participants.map((row) => row.user_id), ['student-1']);
    assert.equal(db.tables.cbt_exam_participants[0].regular_class_id, 'class-1');
    assert.equal(db.tables.cbt_exam_participants[0].additional_class_id, null);
    assert.equal(db.tables.cbt_exams[0].status, 'active');
});

test('ASSIGN-02: kelas tidak dikenal ditolak sebelum target lama dihapus', async () => {
    const db = fixtureDb(tables());
    const service = new ExamAdminService(db, authz, roles);

    await assert.rejects(
        service.assign(user, 'exam-1', ['missing-class'], [], false),
        /kelas tidak ditemukan/i,
    );
    assert.equal(db.tables.cbt_exam_targets[0].id, 'old-target');
    assert.equal(db.tables.cbt_exam_participants[0].id, 'old-participant');
});

test('ASSIGN-03: kelas sekolah lain dan kelas tahun lama ditolak', async () => {
    for (const invalidClass of [
        { id: 'class-1', organization_id: 'school-2', school_year: '2026/2027' },
        { id: 'class-1', organization_id: 'school-1', school_year: '2025/2026' },
    ]) {
        const data = tables();
        data.cbt_classes = [invalidClass];
        const db = fixtureDb(data);
        const service = new ExamAdminService(db, authz, roles);
        await assert.rejects(service.assign(user, 'exam-1', ['class-1'], [], false));
        assert.equal(db.tables.cbt_exam_targets[0].id, 'old-target');
    }
});

test('ASSIGN-04: peserta nonaktif atau sekolah lain ditolak sebelum penghapusan', async () => {
    const data = tables();
    data.cbt_organization_members[0].is_active = false;
    const db = fixtureDb(data);
    const service = new ExamAdminService(db, authz, roles);

    await assert.rejects(
        service.assign(
            user,
            'exam-1',
            [],
            [{ userId: 'student-1', classId: 'class-1' }],
            false,
        ),
        /bukan anggota aktif/i,
    );
    assert.equal(db.tables.cbt_exam_participants[0].id, 'old-participant');
});

test('ASSIGN-05: kegagalan insert peserta mengembalikan target dan peserta lama', async () => {
    const db = fixtureDb(tables(), [], {
        failMutation: { table: 'cbt_exam_participants', mutation: 'insert' },
    });
    const service = new ExamAdminService(db, authz, roles);

    await assert.rejects(
        service.assign(
            user,
            'exam-1',
            ['class-1'],
            [{ userId: 'student-1', classId: 'class-1' }],
            true,
        ),
        /synthetic mutation failure/i,
    );
    assert.deepEqual(db.tables.cbt_exam_targets.map((row) => row.id), ['old-target']);
    assert.deepEqual(db.tables.cbt_exam_participants.map((row) => row.id), ['old-participant']);
    assert.equal(db.tables.cbt_exams[0].status, 'draft');
});
