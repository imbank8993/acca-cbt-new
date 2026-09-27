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
    assert.match(page, /now >= new Date\(exam\.start_time\)/);
    assert.match(page, /Total Jadwal/);
    assert.match(page, /loadError \? '—'/);
});
