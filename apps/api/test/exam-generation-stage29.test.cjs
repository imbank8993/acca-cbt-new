// Run from repository root: node --test apps/api/test/exam-generation-stage29.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { PasSchedulesService } = require('../src/pas/pas-schedules.service.ts');
const { ExamConfigsService } = require('../src/exam-configs/exam-configs.service.ts');

const user = { id: 'proctor-1', isPlatformAdmin: false };
const authz = {
    assertBankAccess: async () => {},
    assertProktorByParent: async () => {},
    assertProktorByRecord: async () => {},
};

function pasTables() {
    return {
        cbt_pas_class_schedules: [{
            id: 'schedule-1', pas_period_id: 'period-1', bank_id: 'bank-1',
            class_id: 'class-1', subject_id: null, exam_id: null,
            scheduled_date: '2026-09-28', scheduled_time: '07:30',
            window_end_time: '09:30', duration_minutes: 90,
        }],
        cbt_pas_periods: [{
            id: 'period-1', organization_id: 'school-1', name: 'PAS', type: 'pas',
            school_year: '2026/2027', semester: 'ganjil',
        }],
        cbt_question_banks: [{ id: 'bank-1', organization_id: 'school-1', title: 'Matematika' }],
        cbt_classes: [{ id: 'class-1', organization_id: 'school-1', name: 'IX A' }],
        cbt_exams: [],
        cbt_exam_targets: [],
    };
}

function configTables() {
    return {
        exam_config_exams: [{
            id: 'config-schedule-1', exam_config_id: 'config-1',
            exam_config_bank_id: 'config-bank-1', class_id: 'class-1', exam_id: null,
            scheduled_date: '2026-09-28', scheduled_time: '10:00', window_end_time: '12:00',
            exam_configs: {
                id: 'config-1', organization_id: 'school-1', name: 'Ujian Bersama',
                school_year: '2026/2027', semester: 'ganjil', is_locked: false,
            },
            exam_config_banks: {
                id: 'config-bank-1', exam_config_id: 'config-1', bank_id: 'bank-1',
                subject_id: null, duration_minutes: 90,
            },
            classes: { id: 'class-1', name: 'IX A', organization_id: 'school-1' },
        }],
        cbt_question_banks: [{ id: 'bank-1', organization_id: 'school-1', title: 'Matematika' }],
        cbt_exams: [],
        cbt_exam_targets: [],
    };
}

test('GEN-01: retry pembangkitan PAS tidak membuat ujian atau target ganda', async () => {
    const db = fixtureDb(pasTables());
    const service = new PasSchedulesService(db, authz);

    const first = await service.generate(user, ['schedule-1', 'schedule-1']);
    const retry = await service.generate(user, ['schedule-1']);

    assert.deepEqual(first, { created: 1, skipped: [] });
    assert.equal(retry.created, 0);
    assert.equal(db.tables.cbt_exams.length, 1);
    // Kelas menjadi target saat jadwalnya diaktifkan, bukan saat dibangkitkan.
    assert.equal(db.tables.cbt_exam_targets.length, 0);
    assert.equal(db.tables.cbt_exams[0].is_published, false);
    assert.equal(db.tables.cbt_pas_class_schedules[0].exam_id, db.tables.cbt_exams[0].id);
});

test('GEN-02: kegagalan menautkan jadwal PAS membatalkan ujian dan target', async () => {
    const db = fixtureDb(pasTables(), [], {
        failMutation: { table: 'cbt_pas_class_schedules', mutation: 'update' },
    });
    const service = new PasSchedulesService(db, authz);

    const result = await service.generate(user, ['schedule-1']);

    assert.equal(result.created, 0);
    assert.match(result.skipped[0], /gagal menautkan ujian/i);
    assert.equal(db.tables.cbt_exams.length, 0);
    assert.equal(db.tables.cbt_exam_targets.length, 0);
    assert.equal(db.tables.cbt_pas_class_schedules[0].exam_id, null);
});

test('GEN-03: retry pembangkitan konfigurasi tidak membuat ujian atau target ganda', async () => {
    const db = fixtureDb(configTables());
    const service = new ExamConfigsService(db, authz);

    const first = await service.generate(user, ['config-schedule-1', 'config-schedule-1']);
    const retry = await service.generate(user, ['config-schedule-1']);

    assert.deepEqual(first, { created: 1, skipped: [] });
    assert.equal(retry.created, 0);
    assert.equal(db.tables.cbt_exams.length, 1);
    assert.equal(db.tables.cbt_exam_targets.length, 1);
    assert.equal(db.tables.exam_config_exams[0].exam_id, db.tables.cbt_exams[0].id);
});

test('GEN-04: kegagalan target konfigurasi membatalkan ujian', async () => {
    const db = fixtureDb(configTables(), [], {
        failMutation: { table: 'cbt_exam_targets', mutation: 'insert' },
    });
    const service = new ExamConfigsService(db, authz);

    const result = await service.generate(user, ['config-schedule-1']);

    assert.equal(result.created, 0);
    assert.match(result.skipped[0], /gagal menetapkan kelas/i);
    assert.equal(db.tables.cbt_exams.length, 0);
    assert.equal(db.tables.exam_config_exams[0].exam_id, null);
});

test('GEN-05: generator dikunci, transaksional, dan memakai kunci sumber stabil', () => {
    const pas = fs.readFileSync(path.resolve(__dirname, '../src/pas/pas-schedules.service.ts'), 'utf8');
    const config = fs.readFileSync(path.resolve(__dirname, '../src/exam-configs/exam-configs.service.ts'), 'utf8');
    for (const source of [pas, config]) {
        assert.match(source, /this\.db\.transaction/);
        assert.match(source, /advisoryTransactionLock/);
        assert.match(source, /insertIdempotentlyWithStatus/);
        assert.match(source, /deriveRequestUuid/);
        assert.match(source, /targetError/);
        assert.match(source, /linkError/);
    }
});

test('GEN-06: relasi jadwal divalidasi terhadap induk dan sekolah yang sama', () => {
    const pas = fs.readFileSync(path.resolve(__dirname, '../src/pas/pas-schedules.service.ts'), 'utf8');
    const config = fs.readFileSync(path.resolve(__dirname, '../src/exam-configs/exam-configs.service.ts'), 'utf8');
    assert.match(pas, /eq\('pas_period_id', dto\.pas_period_id\)/);
    assert.match(pas, /Bank soal tidak ditemukan pada sekolah ini/);
    assert.match(pas, /Kelas tidak ditemukan pada sekolah ini/);
    assert.match(config, /eq\('exam_config_id', dto\.exam_config_id\)/);
    assert.match(config, /Bank soal tidak berada dalam konfigurasi ini/);
    assert.match(config, /kelas bukan milik sekolah konfigurasi/i);
});

test('GEN-07: browser memberi waktu cukup untuk batch dan server menolak jendela invalid', () => {
    const pasApi = fs.readFileSync(path.resolve(__dirname, '../../web/lib/api/pas.ts'), 'utf8');
    const configApi = fs.readFileSync(path.resolve(__dirname, '../../web/lib/api/exam-configs.ts'), 'utf8');
    assert.match(pasApi, /schedules\/generate[\s\S]*timeoutMs: 120_000/);
    assert.match(configApi, /exam-configs\/generate[\s\S]*timeoutMs: 120_000/);
    const pas = fs.readFileSync(path.resolve(__dirname, '../src/pas/pas-schedules.service.ts'), 'utf8');
    const config = fs.readFileSync(path.resolve(__dirname, '../src/exam-configs/exam-configs.service.ts'), 'utf8');
    assert.match(pas, /jendela waktu ujian tidak valid/);
    assert.match(config, /jendela waktu ujian tidak valid/);
});
