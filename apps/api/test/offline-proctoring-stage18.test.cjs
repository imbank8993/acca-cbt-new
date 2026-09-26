// Run from repository root: node --test apps/api/test/offline-proctoring-stage18.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
    project: path.resolve(__dirname, '../tsconfig.json'),
    transpileOnly: true,
});

const { fixtureDb } = require('./fixture-db.cjs');
const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');
const securityStorage = require('../../web/lib/exam-durable-storage.ts');

const user = { id: 'student-1', isPlatformAdmin: false };

function attemptTables() {
    return {
        cbt_exam_attempts: [{
            id: 'attempt-1', user_id: user.id, exam_id: 'exam-1', status: 'in_progress',
            device_fingerprint: 'device-1', warning_count: 0, tab_switch_count: 0,
        }],
        cbt_attempt_security_logs: [],
    };
}

function replaceGlobal(name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    return () => descriptor
        ? Object.defineProperty(globalThis, name, descriptor)
        : delete globalThis[name];
}

test('ANS-07: retry clientEventId yang sama hanya mencatat satu pelanggaran', async () => {
    const db = fixtureDb(attemptTables());
    const service = new ProctoringService(db, {}, {});
    const eventId = 'bed77fa4-435b-40e5-914d-ff80b8cb33a9';

    const first = await service.logViolation(user, 'attempt-1', 'tab_switch', {}, eventId);
    const retry = await service.logViolation(user, 'attempt-1', 'tab_switch', {}, eventId);

    assert.equal(first.warningCount, 1);
    assert.equal(retry.warningCount, 1);
    assert.equal(retry.duplicate, true);
    assert.equal(db.tables.cbt_attempt_security_logs.length, 1);
    assert.equal(db.tables.cbt_exam_attempts[0].warning_count, 1);
});

test('ANS-07: heartbeat memerlukan pemilik dan perangkat yang terikat', async () => {
    const now = '2026-09-26T03:04:05.000Z';
    const db = fixtureDb(attemptTables(), [], { now });
    const service = new ProctoringService(db, {}, {});

    await assert.rejects(
        service.heartbeat(user, 'attempt-1', 'device-lain'),
        error => error.getStatus?.() === 403,
    );
    const result = await service.heartbeat(user, 'attempt-1', 'device-1');
    assert.equal(result.lastSeenAt, now);
    assert.equal(db.tables.cbt_exam_attempts[0].last_seen_at, now);
});

test('ANS-07: antrean event bertahan dan dapat dibersihkan lewat fallback localStorage', async () => {
    const values = new Map();
    const restoreIdb = replaceGlobal('indexedDB', undefined);
    const restoreLocal = replaceGlobal('localStorage', {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    });
    const event = {
        id: '4c3d30bb-d9b4-4ff5-8d44-2828c31f41db',
        attemptId: 'attempt-1',
        eventType: 'tab_switch',
        metadata: { timestamp: '2026-09-26T03:04:05.000Z' },
        createdAt: '2026-09-26T03:04:05.000Z',
    };
    try {
        const saved = await securityStorage.enqueueSecurityEvent(event);
        assert.equal(saved.mode, 'localstorage');
        assert.deepEqual(await securityStorage.readSecurityEvents('attempt-1'), [event]);
        await securityStorage.removeSecurityEvent('attempt-1', event.id);
        assert.deepEqual(await securityStorage.readSecurityEvents('attempt-1'), []);
    } finally {
        restoreLocal();
        restoreIdb();
    }

    const source = fs.readFileSync(
        path.resolve(__dirname, '../../web/lib/exam-durable-storage.ts'), 'utf8',
    );
    assert.match(source, /SECURITY_EVENT_STORE = 'security-events'/);
    assert.match(source, /enqueueSecurityEvent/);
    assert.match(source, /readSecurityEvents/);
    assert.match(source, /removeSecurityEvent/);
    assert.match(source, /exam_security_events_/);
});

test('ANS-07: halaman menunggu konfirmasi server sebelum membersihkan sesi', () => {
    const source = fs.readFileSync(
        path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'), 'utf8',
    );
    const confirmation = source.indexOf('if (!result.success) return false;');
    const clearSession = source.indexOf('await clearCbtSession();', confirmation);
    assert.ok(confirmation >= 0 && clearSession > confirmation);
    assert.match(source, /terminationPending/);
    assert.match(source, /heartbeatExamAttempt/);
    assert.match(source, /flushSecurityEvents/);
});

test('ANS-07: monitoring semua peran menampilkan status koneksi terputus', () => {
    for (const role of ['admin', 'guru', 'proktor', 'pengawas']) {
        const source = fs.readFileSync(
            path.resolve(__dirname, `../../web/app/dashboard/${role}/monitoring/page.tsx`), 'utf8',
        );
        assert.match(source, /connection_status/);
        assert.match(source, /Koneksi terputus/i);
    }

    const migration = fs.readFileSync(
        path.resolve(__dirname, '../../../database/migrations/20260926_02_offline_proctoring.sql'), 'utf8',
    );
    assert.match(migration, /last_seen_at/);
    assert.match(migration, /CREATE UNIQUE INDEX[\s\S]*client_event_id/i);
});
