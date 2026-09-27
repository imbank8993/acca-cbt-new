// Run from repository root: node apps/api/test/pas-session-integrity-stage36.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { PasSchedulesService } = require('../src/pas/pas-schedules.service.ts');
const { PasService } = require('../src/pas/pas.service.ts');

const user = { id: 'proctor-1', isPlatformAdmin: false };
const authz = {
    assertProktor: async () => {},
    assertProktorByRecord: async () => {},
    assertProktorByParent: async () => {},
};

function tables(locked = false) {
    return {
        cbt_pas_periods: [{
            id: 'period-1', organization_id: 'school-1', name: 'PAS', type: 'pas',
            school_year: '2026/2027', semester: 'ganjil', start_date: '2026-09-01',
            end_date: '2026-09-30', is_locked: locked,
        }],
        cbt_pas_sessions: [
            { id: 'session-used', pas_period_id: 'period-1', name: 'Sesi 1', start_time: '07:30', end_time: '09:30' },
            { id: 'session-free', pas_period_id: 'period-1', name: 'Sesi 2', start_time: '10:00', end_time: '12:00' },
        ],
        cbt_pas_class_schedules: [{
            id: 'schedule-1', pas_period_id: 'period-1', session_id: 'session-used',
            bank_id: 'bank-1', class_id: 'class-1', subject_id: null, exam_id: null,
            scheduled_date: '2026-09-15', scheduled_time: '07:30',
            window_end_time: '09:30', duration_minutes: 90, status: 'scheduled',
        }],
        cbt_question_banks: [{ id: 'bank-1', organization_id: 'school-1', title: 'Matematika' }],
        cbt_classes: [{ id: 'class-1', organization_id: 'school-1', name: 'IX A' }],
        cbt_exams: [],
        cbt_exam_targets: [],
        cbt_exam_attempts: [],
        cbt_certificates: [],
    };
}

test('SESSION-01: periode terkunci menolak penambahan sesi', async () => {
    const db = fixtureDb(tables(true));
    const service = new PasSchedulesService(db, authz);

    await assert.rejects(
        service.createSession(user, 'period-1', {
            clientRequestId: '00000000-0000-4000-8000-000000000001',
            name: 'Sesi 3', start_time: '13:00', end_time: '15:00',
        }),
        /periode sudah dikunci/i,
    );
    assert.equal(db.tables.cbt_pas_sessions.length, 2);
});

test('SESSION-02: sesi yang dipakai jadwal tidak dapat dihapus', async () => {
    const db = fixtureDb(tables());
    const service = new PasSchedulesService(db, authz);

    await assert.rejects(
        service.removeSession(user, 'session-used'),
        /masih dipakai oleh jadwal/i,
    );
    assert.equal(db.tables.cbt_pas_sessions.some((row) => row.id === 'session-used'), true);
    assert.equal(db.tables.cbt_pas_class_schedules[0].session_id, 'session-used');
});

test('SESSION-03: sesi bebas dapat dihapus, tetapi periode terkunci menolaknya', async () => {
    const db = fixtureDb(tables());
    const service = new PasSchedulesService(db, authz);
    await service.removeSession(user, 'session-free');
    assert.equal(db.tables.cbt_pas_sessions.some((row) => row.id === 'session-free'), false);

    const lockedDb = fixtureDb(tables(true));
    const lockedService = new PasSchedulesService(lockedDb, authz);
    await assert.rejects(
        lockedService.removeSession(user, 'session-free'),
        /periode sudah dikunci/i,
    );
    assert.equal(lockedDb.tables.cbt_pas_sessions.length, 2);
});

test('SESSION-04: jadwal pada periode terkunci tidak dapat ditambah atau dihapus', async () => {
    const db = fixtureDb(tables(true));
    const service = new PasSchedulesService(db, authz);
    const dto = {
        clientRequestId: '00000000-0000-4000-8000-000000000002',
        pas_period_id: 'period-1', bank_id: 'bank-1', class_id: 'class-1',
        session_id: 'session-used', scheduled_date: '2026-09-16', duration_override: 90,
    };

    await assert.rejects(service.addSchedule(user, dto), /periode sudah dikunci/i);
    await assert.rejects(service.removeSchedule(user, 'schedule-1'), /periode sudah dikunci/i);
    assert.equal(db.tables.cbt_pas_class_schedules.length, 1);
});

test('SESSION-05: generate pada periode terkunci dilewati tanpa membuat ujian', async () => {
    const db = fixtureDb(tables(true));
    const service = new PasSchedulesService(db, authz);

    const result = await service.generate(user, ['schedule-1']);
    assert.equal(result.created, 0);
    assert.match(result.skipped[0], /periode terkunci/i);
    assert.equal(db.tables.cbt_exams.length, 0);
    assert.equal(db.tables.cbt_pas_class_schedules[0].exam_id, null);
});

test('SESSION-06: penguncian periode memakai lock transaksi yang sama', async () => {
    const db = fixtureDb(tables());
    let periodLocks = 0;
    const raw = db.raw;
    db.raw = async (...args) => {
        if (String(args[1]).startsWith('pas-period:')) periodLocks++;
        return raw(...args);
    };
    const service = new PasService(db, authz);

    await service.setPeriodLock(user, 'period-1', true);
    assert.equal(periodLocks, 1);
    assert.equal(db.tables.cbt_pas_periods[0].is_locked, true);
});

test('SESSION-07: database mewajibkan sesi satu periode dan menolak delete', () => {
    const migration = fs.readFileSync(
        path.resolve(__dirname, '../../../database/migrations/20260927_07_pas_session_integrity.sql'),
        'utf8',
    );
    assert.match(migration, /ALTER COLUMN session_id SET NOT NULL/i);
    assert.match(migration, /FOREIGN KEY \(session_id, pas_period_id\)/i);
    assert.match(migration, /REFERENCES public\.cbt_pas_sessions \(id, pas_period_id\)/i);
    assert.match(migration, /ON DELETE RESTRICT/i);
    assert.match(migration, /end_time > start_time/i);
    assert.match(migration, /window_end_time > scheduled_time/i);
});

test('SESSION-08: UI Admin dan Proktor menyembunyikan mutasi saat terkunci', () => {
    for (const role of ['admin', 'proktor']) {
        const source = fs.readFileSync(
            path.resolve(__dirname, `../../web/app/dashboard/${role}/pas/RoomManagementModal.tsx`),
            'utf8',
        );
        assert.match(source, /if \(period\.is_locked\) return/);
        assert.match(source, /Periode terkunci/);
        assert.match(source, /!period\.is_locked && isCreatingSession/);
        assert.match(source, /!period\.is_locked && \(/);
    }
});

