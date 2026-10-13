// Run from repository root: node --test apps/api/test/student-schedule-stage32.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const {
    PostgrestQueryBuilder,
    splitPostgrestOrExpression,
} = require('../src/prisma/prisma-db-adapter.ts');

const CLASS_1 = '11111111-1111-4111-8111-111111111111';
const CLASS_2 = '22222222-2222-4222-8222-222222222222';
const EXTRA = '33333333-3333-4333-8333-333333333333';

test('SCHEDULE-01: koma di dalam daftar IN tidak memecah cabang OR', () => {
    assert.deepEqual(
        splitPostgrestOrExpression(
            `class_id.in.(${CLASS_1},${CLASS_2}),additional_class_id.in.(${EXTRA})`,
        ),
        [
            `class_id.in.(${CLASS_1},${CLASS_2})`,
            `additional_class_id.in.(${EXTRA})`,
        ],
    );
});

test('SCHEDULE-02: adapter mengikat seluruh ID kelas sebagai UUID yang utuh', async () => {
    let captured;
    const prisma = {
        async $queryRawUnsafe(sql, ...params) {
            captured = { sql, params };
            return [];
        },
    };
    const registry = {
        async ensureLoaded() {},
        columnType(_table, column) {
            return ['class_id', 'additional_class_id', 'exam_id'].includes(column) ? 'uuid' : null;
        },
    };

    const result = await new PostgrestQueryBuilder('cbt_exam_targets', prisma, registry)
        .select('exam_id')
        .or(`class_id.in.(${CLASS_1},${CLASS_2}),additional_class_id.in.(${EXTRA})`);

    assert.equal(result.error, null);
    assert.match(captured.sql, /"class_id" IN \(\$1::uuid, \$2::uuid\)/);
    assert.match(captured.sql, /OR "cbt_exam_targets"\."additional_class_id" IN \(\$3::uuid\)/);
    assert.deepEqual(captured.params, [CLASS_1, CLASS_2, EXTRA]);
});

test('SCHEDULE-03: status tersedia mensyaratkan waktu mulai sudah tiba', () => {
    const page = fs.readFileSync(
        path.resolve(__dirname, '../../web/app/dashboard/siswa/schedule/page.tsx'),
        'utf8',
    );
    const { scheduleState } = require('../../web/lib/student-schedule.ts');
    const exam = { is_published: true, isCompleted: false, start_time: '2026-10-13T01:00:00Z', end_time: '2026-10-13T02:00:00Z' };
    assert.equal(scheduleState(exam, Date.parse('2026-10-13T00:59:59Z')), 'upcoming');
    assert.equal(scheduleState(exam, Date.parse(exam.start_time)), 'open');
    assert.equal(scheduleState(exam, Date.parse(exam.end_time) + 1), 'closed');
    assert.match(page, /Total Jadwal/);
    assert.match(page, /loadError \? '—'/);
});

test('Schedule countdown uses unambiguous day/hour units and rejects invalid dates', () => {
    const { scheduleCountdown, scheduleState } = require('../../web/lib/student-schedule.ts');
    const now = Date.parse('2026-10-13T00:00:00Z');
    assert.equal(scheduleCountdown('2026-10-14T03:00:00Z', now), '1 hari 3 jam lagi');
    assert.equal(scheduleCountdown('2026-10-13T00:00:30Z', now), 'Kurang dari 1 menit lagi');
    assert.equal(scheduleCountdown('bad', now), '');
    assert.equal(scheduleState({ is_published: true, start_time: 'bad' }, now), 'invalid');
    assert.equal(scheduleState({ is_published: true, isCompleted: true }, now), 'closed');
    assert.equal(scheduleState({ is_published: true, status: 'archived' }, now), 'closed');
});

test('Schedule retains expired exams and fails explicitly for unavailable data', async () => {
    const { StudentsService } = require('../src/students/students.service.ts');
    const { fixtureDb } = require('./fixture-db.cjs');
    const data = {
        cbt_organization_members: [{ user_id: 'student', organization_id: 'school', is_active: true }],
        cbt_exams: [{ id: 'old', organization_id: 'school', is_published: true, end_time: '2020-01-01T00:00:00Z', metadata: { is_public: true } }],
        cbt_exam_attempts: [{ exam_id: 'old', user_id: 'student', status: 'submitted' }],
    };
    const user = { id: 'student' };
    const db = fixtureDb(data);
    const result = await new StudentsService(db).listExams(user);
    assert.equal(result[0].id, 'old'); assert.equal(result[0].isCompleted, true);
    assert.ok(!db.queries.find(q => q.table === 'cbt_exams').calls.some(call => call[0] === 'or'));
    await assert.rejects(new StudentsService(fixtureDb(data, ['cbt_exams'])).listExams(user), /belum dapat dimuat/);
    await assert.rejects(new StudentsService(fixtureDb(data, ['cbt_exam_attempts'])).listExams(user), /belum dapat dimuat/);
});
