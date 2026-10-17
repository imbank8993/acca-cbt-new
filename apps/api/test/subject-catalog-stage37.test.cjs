// Run from repository root: node apps/api/test/subject-catalog-stage37.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { PasService } = require('../src/pas/pas.service.ts');
const { PasSchedulesService } = require('../src/pas/pas-schedules.service.ts');
const { ExamConfigsService } = require('../src/exam-configs/exam-configs.service.ts');

const user = { id: 'proctor-1', isPlatformAdmin: false };
const authz = {
    assertOrgStaff: async () => {},
    assertProktorByRecord: async () => {},
    assertProktorByParent: async () => {},
    assertBankAccess: async () => {},
};

function catalogTables() {
    return {
        master_mapel: [
            { id: '11', kode: 'MAT', nama: 'Matematika', kelompok: 'A', aktif: true },
            { id: '12', kode: 'OLD', nama: 'Mapel Lama', kelompok: 'B', aktif: false },
        ],
        cbt_subjects: [],
    };
}

test('SUBJECT-01: master angka disinkronkan menjadi ID operasional stabil', async () => {
    const db = fixtureDb(catalogTables());
    const service = new PasService(db, authz);

    const first = await service.listSubjects(user, 'school-1');
    const second = await service.listSubjects(user, 'school-1');

    assert.equal(first.length, 1);
    assert.equal(first[0].name, 'Matematika');
    assert.equal(first[0].master_mapel_id, '11');
    assert.equal(first[0].id, second[0].id);
    assert.equal(db.tables.cbt_subjects.length, 2);
    assert.equal(db.tables.cbt_subjects.find((row) => row.master_mapel_id === '12').is_active, false);
});

test('SUBJECT-02: perubahan nama/status master diselaraskan tanpa mengganti ID', async () => {
    const db = fixtureDb(catalogTables());
    const service = new PasService(db, authz);
    const before = await service.listSubjects(user, 'school-1');

    db.tables.master_mapel[0].nama = 'Matematika Lanjutan';
    db.tables.master_mapel[1].aktif = true;
    const after = await service.listSubjects(user, 'school-1');

    assert.equal(after.find((row) => row.master_mapel_id === '11').id, before[0].id);
    assert.equal(after.find((row) => row.master_mapel_id === '11').name, 'Matematika Lanjutan');
    assert.equal(after.some((row) => row.master_mapel_id === '12'), true);
});

function scheduleTables(subjectOrganization = 'school-1') {
    return {
        cbt_pas_periods: [{
            id: 'period-1', organization_id: 'school-1', is_locked: false,
            start_date: '2026-09-01', end_date: '2026-09-30',
        }],
        cbt_pas_sessions: [{
            id: 'session-1', pas_period_id: 'period-1', start_time: '07:30', end_time: '09:30',
        }],
        cbt_question_banks: [{ id: 'bank-1', organization_id: 'school-1' }],
        cbt_classes: [{ id: 'class-1', organization_id: 'school-1' }],
        cbt_subjects: [{
            id: 'subject-1', organization_id: subjectOrganization, is_active: true,
        }],
        cbt_pas_class_schedules: [],
    };
}

test('SUBJECT-03: jadwal menyimpan UUID mapel aktif dari sekolah yang sama', async () => {
    const db = fixtureDb(scheduleTables());
    const service = new PasSchedulesService(db, authz);
    await service.addSchedule(user, {
        clientRequestId: '00000000-0000-4000-8000-000000000037',
        pas_period_id: 'period-1', bank_id: 'bank-1', class_id: 'class-1',
        session_id: 'session-1', scheduled_date: '2026-09-15',
        subject_id: 'subject-1', duration_override: 90,
    });

    assert.equal(db.tables.cbt_pas_class_schedules.length, 1);
    assert.equal(db.tables.cbt_pas_class_schedules[0].subject_id, 'subject-1');
});

test('SUBJECT-04: UUID mapel sekolah lain atau nonaktif ditolak', async () => {
    for (const row of [
        { organization_id: 'school-2', is_active: true },
        { organization_id: 'school-1', is_active: false },
    ]) {
        const data = scheduleTables(row.organization_id);
        data.cbt_subjects[0].is_active = row.is_active;
        const db = fixtureDb(data);
        const service = new PasSchedulesService(db, authz);
        await assert.rejects(
            service.addSchedule(user, {
                clientRequestId: '00000000-0000-4000-8000-000000000038',
                pas_period_id: 'period-1', bank_id: 'bank-1', class_id: 'class-1',
                session_id: 'session-1', scheduled_date: '2026-09-15',
                subject_id: 'subject-1',
            }),
            /mata pelajaran aktif tidak ditemukan/i,
        );
        assert.equal(db.tables.cbt_pas_class_schedules.length, 0);
    }
});

test('SUBJECT-05: kedua endpoint memakai katalog bersama dan DTO tetap UUID', () => {
    const pas = fs.readFileSync(path.resolve(__dirname, '../src/pas/pas.service.ts'), 'utf8');
    const proctor = fs.readFileSync(path.resolve(__dirname, '../src/proctor/proctor.service.ts'), 'utf8');
    const dto = fs.readFileSync(path.resolve(__dirname, '../src/pas/dto/pas.dto.ts'), 'utf8');
    assert.match(pas, /listOperationalSubjects\(this\.db, organizationId\)/);
    assert.match(proctor, /listOperationalSubjects\(this\.db, organizationId\)/);
    assert.match(dto, /IsUUID\('4', \{ message: 'subject_id tidak valid' \}\)/);
});

test('SUBJECT-06: migrasi menyimpan mapping master dan backfill seluruh mapel', () => {
    const migration = fs.readFileSync(
        path.resolve(__dirname, '../../../database/migrations/20260927_08_subject_catalog_bridge.sql'),
        'utf8',
    );
    assert.match(migration, /ADD COLUMN IF NOT EXISTS master_mapel_id bigint/i);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL/i);
    assert.match(migration, /cbt_subjects_org_master_unique/i);
    assert.match(migration, /FROM public\.master_mapel master/i);
    assert.match(migration, /ON CONFLICT \(organization_id, master_mapel_id\) DO UPDATE/i);
});

test('SUBJECT-07: UUID hasil katalog diterima konfigurasi ujian', async () => {
    const data = catalogTables();
    data.exam_configs = [{ id: 'config-1', organization_id: 'school-1', is_locked: false }];
    data.cbt_question_banks = [{ id: 'bank-1', organization_id: 'school-1' }];
    data.exam_config_banks = [];
    const db = fixtureDb(data);
    const pas = new PasService(db, authz);
    const configs = new ExamConfigsService(db, authz);
    const [subject] = await pas.listSubjects(user, 'school-1');

    await configs.addBank(user, {
        clientRequestId: '00000000-0000-4000-8000-000000000039',
        exam_config_id: 'config-1', bank_id: 'bank-1',
        subject_id: subject.id, duration_minutes: 90,
    });

    assert.equal(db.tables.exam_config_banks.length, 1);
    assert.equal(db.tables.exam_config_banks[0].subject_id, subject.id);
});
