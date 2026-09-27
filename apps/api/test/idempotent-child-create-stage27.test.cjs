// Run from repository root: node apps/api/test/idempotent-child-create-stage27.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { insertIdempotently } = require('../src/common/idempotent-create.ts');

test('IDM-07: tabel anak memakai lingkup parent dan mengembalikan ID lama', async () => {
    const db = fixtureDb({ cbt_pas_sessions: [] });
    const options = {
        table: 'cbt_pas_sessions',
        scope: { column: 'pas_period_id', value: 'period-1' },
        clientRequestId: '33333333-3333-4333-8333-333333333333',
        fingerprint: { name: 'Sesi 1', start_time: '07:30', end_time: '09:00' },
        payload: { pas_period_id: 'period-1', name: 'Sesi 1' },
    };
    const first = await insertIdempotently(db, options);
    const retry = await insertIdempotently(db, options);
    assert.equal(first.id, retry.id);
    assert.equal(db.tables.cbt_pas_sessions.length, 1);
});

test('IDM-08: UUID sama boleh dipakai pada parent berbeda', async () => {
    const db = fixtureDb({ cbt_pas_rooms: [] });
    const base = {
        table: 'cbt_pas_rooms',
        clientRequestId: '44444444-4444-4444-8444-444444444444',
        fingerprint: { name: 'Lab 1', capacity: 30 },
    };
    await insertIdempotently(db, {
        ...base, scope: { column: 'pas_period_id', value: 'period-1' },
        payload: { pas_period_id: 'period-1', name: 'Lab 1', capacity: 30 },
    });
    await insertIdempotently(db, {
        ...base, scope: { column: 'pas_period_id', value: 'period-2' },
        payload: { pas_period_id: 'period-2', name: 'Lab 1', capacity: 30 },
    });
    assert.equal(db.tables.cbt_pas_rooms.length, 2);
});

test('IDM-09: delapan tabel turunan mempunyai indeks request unik', () => {
    const sql = fs.readFileSync(
        path.resolve(__dirname, '../../../database/migrations/20260927_02_idempotent_child_creates.sql'),
        'utf8',
    );
    for (const table of [
        'school_years', 'bank_folders', 'cbt_organization_labels', 'cbt_pas_sessions',
        'cbt_pas_rooms', 'cbt_pas_class_schedules', 'exam_config_banks', 'exam_config_exams',
    ]) {
        assert.match(sql, new RegExp(`ALTER TABLE public\\.${table}`));
        assert.match(sql, new RegExp(`${table}_client_request_unique`));
    }
});

test('IDM-10: race identitas bisnis ditutup dan duplikat lama gagal tertutup', () => {
    const sql = fs.readFileSync(
        path.resolve(__dirname, '../../../database/migrations/20260927_02_idempotent_child_creates.sql'),
        'utf8',
    );
    assert.match(sql, /GROUP BY pas_period_id, bank_id, class_id HAVING COUNT\(\*\) > 1/);
    assert.match(sql, /cbt_pas_schedule_business_unique/);
    assert.match(sql, /exam_config_banks_business_unique/);
    assert.match(sql, /exam_config_exams_business_unique/);
    assert.doesNotMatch(sql, /DELETE FROM/);
});

test('IDM-11: seluruh aksi pembuatan turunan memakai apiCreate dan DTO UUID', () => {
    const sources = [
        '../../web/lib/api/proctor.ts', '../../web/lib/api/questions.ts',
        '../../web/lib/api/pas.ts', '../../web/lib/api/exam-configs.ts',
    ].map(file => fs.readFileSync(path.resolve(__dirname, file), 'utf8')).join('\n');
    for (const endpoint of [
        '/api/proctor/school-years', '/api/question-banks/folders', '/api/question-banks/labels',
        '/api/pas/schedules', '/api/exam-configs/banks', '/api/exam-configs/schedules',
    ]) {
        assert.match(sources, new RegExp(`apiCreate<[\\s\\S]{0,180}${endpoint.replaceAll('/', '\\/')}`));
    }
    for (const file of [
        '../src/proctor/dto/proctor.dto.ts', '../src/questions/dto/questions.dto.ts',
        '../src/pas/dto/pas.dto.ts', '../src/exam-configs/dto/exam-configs.dto.ts',
    ]) {
        const dto = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
        assert.match(dto, /clientRequestId/);
        assert.match(dto, /@IsUUID\('4'/);
    }
});
