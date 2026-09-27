// Run from repository root: node apps/api/test/generated-exam-sync-stage35.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { ExamConfigsService } = require('../src/exam-configs/exam-configs.service.ts');

const user = { id: 'proctor-1', isPlatformAdmin: false };
const authz = {
    assertProktorByRecord: async () => {},
    assertProktorByParent: async () => {},
};

function tables() {
    return {
        exam_configs: [{
            id: 'config-1', organization_id: 'school-1', name: 'PAS Lama',
            school_year: '2025/2026', semester: 'ganjil', start_date: '2026-09-01',
            end_date: '2026-09-30', is_locked: false,
        }],
        exam_config_banks: [{
            id: 'bank-row-1', exam_config_id: 'config-1', bank_id: 'bank-1',
            subject_id: 'subject-1', duration_minutes: 90,
        }],
        exam_config_exams: [{
            id: 'schedule-1', exam_config_id: 'config-1',
            exam_config_bank_id: 'bank-row-1', class_id: 'class-1',
            exam_id: 'exam-1', scheduled_date: '2026-09-15',
        }],
        cbt_classes: [{ id: 'class-1', organization_id: 'school-1', name: 'IX A' }],
        cbt_subjects: [
            { id: 'subject-1', organization_id: 'school-1', is_active: true },
            { id: 'subject-2', organization_id: 'school-1', is_active: true },
            { id: 'subject-other', organization_id: 'school-2', is_active: true },
        ],
        cbt_exams: [{
            id: 'exam-1', subject_id: 'subject-1', duration_minutes: 90,
            description: 'Kelas IX A | PAS Lama | 2025/2026',
        }],
        cbt_exam_attempts: [],
        cbt_certificates: [],
    };
}

test('SYNC-01: perubahan durasi dan mapel menyelaraskan ujian hasil generate', async () => {
    const db = fixtureDb(tables());
    const service = new ExamConfigsService(db, authz);

    await service.updateBank(user, 'bank-row-1', {
        subject_id: 'subject-2', duration_minutes: 120,
    });

    assert.equal(db.tables.exam_config_banks[0].subject_id, 'subject-2');
    assert.equal(db.tables.exam_config_banks[0].duration_minutes, 120);
    assert.equal(db.tables.cbt_exams[0].subject_id, 'subject-2');
    assert.equal(db.tables.cbt_exams[0].duration_minutes, 120);
});

test('SYNC-02: riwayat siswa menolak perubahan dan mempertahankan kedua sisi', async () => {
    const data = tables();
    data.cbt_exam_attempts.push({ id: 'attempt-1', exam_id: 'exam-1' });
    const db = fixtureDb(data);
    const service = new ExamConfigsService(db, authz);

    await assert.rejects(
        service.updateBank(user, 'bank-row-1', { duration_minutes: 120 }),
        /sudah memiliki pengerjaan siswa atau sertifikat/i,
    );
    assert.equal(db.tables.exam_config_banks[0].duration_minutes, 90);
    assert.equal(db.tables.cbt_exams[0].duration_minutes, 90);
});

test('SYNC-03: kegagalan sinkronisasi membatalkan perubahan sumber', async () => {
    const db = fixtureDb(tables(), [], {
        failMutation: { table: 'cbt_exams', mutation: 'update' },
    });
    const service = new ExamConfigsService(db, authz);

    await assert.rejects(
        service.updateBank(user, 'bank-row-1', { duration_minutes: 120 }),
        /gagal menyelaraskan ujian/i,
    );
    assert.equal(db.tables.exam_config_banks[0].duration_minutes, 90);
    assert.equal(db.tables.cbt_exams[0].duration_minutes, 90);
});

test('SYNC-04: konfigurasi terkunci dan mapel sekolah lain ditolak', async () => {
    const locked = tables();
    locked.exam_configs[0].is_locked = true;
    const lockedService = new ExamConfigsService(fixtureDb(locked), authz);
    await assert.rejects(
        lockedService.updateBank(user, 'bank-row-1', { duration_minutes: 120 }),
        /sudah dikunci/i,
    );

    const db = fixtureDb(tables());
    const service = new ExamConfigsService(db, authz);
    await assert.rejects(
        service.updateBank(user, 'bank-row-1', { subject_id: 'subject-other' }),
        /mata pelajaran tidak ditemukan pada sekolah ini/i,
    );
    assert.equal(db.tables.exam_config_banks[0].subject_id, 'subject-1');
    assert.equal(db.tables.cbt_exams[0].subject_id, 'subject-1');
});

test('SYNC-05: nama dan tahun konfigurasi menyelaraskan deskripsi ujian', async () => {
    const db = fixtureDb(tables());
    const service = new ExamConfigsService(db, authz);

    await service.update(user, 'config-1', {
        name: 'PAS Baru', school_year: '2026/2027',
    });

    assert.equal(db.tables.exam_configs[0].name, 'PAS Baru');
    assert.equal(db.tables.exam_configs[0].school_year, '2026/2027');
    assert.equal(db.tables.cbt_exams[0].description, 'Kelas IX A | PAS Baru | 2026/2027');
});

test('SYNC-06: perubahan identik tetap aman setelah ada riwayat', async () => {
    const data = tables();
    data.cbt_exam_attempts.push({ id: 'attempt-1', exam_id: 'exam-1' });
    const db = fixtureDb(data);
    const service = new ExamConfigsService(db, authz);

    await service.updateBank(user, 'bank-row-1', { duration_minutes: 90 });
    await service.update(user, 'config-1', { name: 'PAS Lama' });

    assert.equal(db.tables.cbt_exams[0].duration_minutes, 90);
    assert.equal(db.tables.cbt_exams[0].description, 'Kelas IX A | PAS Lama | 2025/2026');
});

test('SYNC-07: rentang tanggal tidak boleh meninggalkan jadwal di luarnya', async () => {
    const db = fixtureDb(tables());
    const service = new ExamConfigsService(db, authz);

    await assert.rejects(
        service.update(user, 'config-1', { start_date: '2026-09-20' }),
        /ada jadwal di luar rentang baru/i,
    );
    assert.equal(db.tables.exam_configs[0].start_date, '2026-09-01');
});

test('SYNC-08: jadwal baru di luar rentang atau dengan jam terbalik ditolak', async () => {
    const db = fixtureDb(tables());
    const service = new ExamConfigsService(db, authz);
    const base = {
        clientRequestId: '00000000-0000-4000-8000-000000000001',
        exam_config_id: 'config-1', exam_config_bank_id: 'bank-row-1',
        class_id: 'class-1', scheduled_time: '09:00', window_end_time: '10:00',
    };

    await assert.rejects(
        service.addSchedule(user, { ...base, scheduled_date: '2026-10-01' }),
        /di dalam rentang tanggal konfigurasi/i,
    );
    await assert.rejects(
        service.addSchedule(user, {
            ...base, scheduled_date: '2026-09-20', window_end_time: '08:00',
        }),
        /jam tutup ujian harus setelah jam mulai/i,
    );
    assert.equal(db.tables.exam_config_exams.length, 1);
});

test('SYNC-09: kegagalan sinkronisasi deskripsi membatalkan perubahan konfigurasi', async () => {
    const db = fixtureDb(tables(), [], {
        failMutation: { table: 'cbt_exams', mutation: 'update' },
    });
    const service = new ExamConfigsService(db, authz);

    await assert.rejects(
        service.update(user, 'config-1', { name: 'Nama Gagal' }),
        /gagal menyelaraskan ujian/i,
    );
    assert.equal(db.tables.exam_configs[0].name, 'PAS Lama');
    assert.equal(db.tables.cbt_exams[0].description, 'Kelas IX A | PAS Lama | 2025/2026');
});
