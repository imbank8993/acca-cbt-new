// Run from repository root: node --test apps/api/test/idempotent-create-stage26.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
    project: path.resolve(__dirname, '../tsconfig.json'),
    transpileOnly: true,
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node' },
});

const { fixtureDb } = require('./fixture-db.cjs');
const { insertIdempotently } = require('../src/common/idempotent-create.ts');

function memoryStorage() {
    const values = new Map();
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
        get size() { return values.size; },
    };
}

function okResponse(id) {
    return { ok: true, status: 201, text: async () => JSON.stringify({ success: true, id }) };
}

test('IDM-01: retry jaringan memakai clientRequestId yang sama', async () => {
    const originalFetch = global.fetch;
    const originalStorage = global.sessionStorage;
    global.sessionStorage = memoryStorage();
    const bodies = [];
    global.fetch = async (_path, init) => {
        bodies.push(JSON.parse(init.body));
        if (bodies.length === 1) throw new Error('connection lost');
        return okResponse('exam-1');
    };

    try {
        const { apiCreate } = require('../../web/lib/api/client.ts');
        const first = await apiCreate('/api/proctor/exams', { title: 'Ujian A' }, { timeoutMs: 50 });
        const second = await apiCreate('/api/proctor/exams', { title: 'Ujian A' }, { timeoutMs: 50 });
        assert.equal(first.success, false);
        assert.equal(second.success, true);
        assert.equal(bodies[0].clientRequestId, bodies[1].clientRequestId);
        assert.match(bodies[0].clientRequestId, /^[0-9a-f-]{36}$/i);
        assert.equal(global.sessionStorage.size, 0);
    } finally {
        global.fetch = originalFetch;
        global.sessionStorage = originalStorage;
    }
});

test('IDM-02: payload berbeda mendapat kunci berbeda', async () => {
    const originalFetch = global.fetch;
    const originalStorage = global.sessionStorage;
    global.sessionStorage = memoryStorage();
    const bodies = [];
    global.fetch = async (_path, init) => {
        bodies.push(JSON.parse(init.body));
        throw new Error('offline');
    };

    try {
        const { apiCreate } = require('../../web/lib/api/client.ts');
        await apiCreate('/api/proctor/classes', { name: 'A' }, { timeoutMs: 50 });
        await apiCreate('/api/proctor/classes', { name: 'B' }, { timeoutMs: 50 });
        assert.notEqual(bodies[0].clientRequestId, bodies[1].clientRequestId);
    } finally {
        global.fetch = originalFetch;
        global.sessionStorage = originalStorage;
    }
});

test('IDM-03: server mengembalikan baris lama untuk retry identik', async () => {
    const db = fixtureDb({ cbt_exams: [] });
    const options = {
        table: 'cbt_exams',
        organizationId: 'school-1',
        clientRequestId: '11111111-1111-4111-8111-111111111111',
        fingerprint: { title: 'Ujian A', duration: 60 },
        payload: { organization_id: 'school-1', title: 'Ujian A', duration_minutes: 60 },
    };
    const first = await insertIdempotently(db, options);
    const second = await insertIdempotently(db, options);
    assert.equal(first.id, second.id);
    assert.equal(db.tables.cbt_exams.length, 1);
});

test('IDM-04: satu kunci ditolak bila isi permintaannya berubah', async () => {
    const db = fixtureDb({ cbt_exams: [] });
    const base = {
        table: 'cbt_exams', organizationId: 'school-1',
        clientRequestId: '22222222-2222-4222-8222-222222222222',
        payload: { organization_id: 'school-1', title: 'Ujian A' },
    };
    await insertIdempotently(db, { ...base, fingerprint: { title: 'Ujian A' } });
    await assert.rejects(
        insertIdempotently(db, { ...base, fingerprint: { title: 'Ujian B' } }),
        /data yang berbeda/i,
    );
    assert.equal(db.tables.cbt_exams.length, 1);
});

test('IDM-05: enam jenis data penting dilindungi indeks unik', () => {
    const sql = fs.readFileSync(
        path.resolve(__dirname, '../../../database/migrations/20260927_01_idempotent_creates.sql'),
        'utf8',
    );
    for (const table of [
        'cbt_exams', 'cbt_classes', 'cbt_additional_classes',
        'cbt_pas_periods', 'exam_configs', 'cbt_question_banks',
    ]) {
        assert.match(sql, new RegExp(`ALTER TABLE public\\.${table}`));
        assert.match(sql, new RegExp(`${table}_client_request_unique`));
    }
});

test('IDM-06: seluruh aksi pembuatan utama memakai apiCreate', () => {
    const files = ['proctor.ts', 'teachers.ts', 'pas.ts', 'exam-configs.ts', 'questions.ts'];
    for (const file of files) {
        const source = fs.readFileSync(path.resolve(__dirname, `../../web/lib/api/${file}`), 'utf8');
        assert.match(source, /apiCreate/);
    }
    const proctor = fs.readFileSync(path.resolve(__dirname, '../../web/lib/api/proctor.ts'), 'utf8');
    assert.match(proctor, /apiCreate<[\s\S]*\/api\/proctor\/classes\/import/);
    const service = fs.readFileSync(path.resolve(__dirname, '../src/proctor/classes.service.ts'), 'utf8');
    assert.match(service, /deriveRequestUuid\(clientRequestId, index\)/);
});
