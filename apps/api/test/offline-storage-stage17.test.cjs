// Run from repository root: node --test apps/api/test/offline-storage-stage17.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
    project: path.resolve(__dirname, '../../web/tsconfig.json'),
    transpileOnly: true,
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node' },
});

const { createSerializedWriter, inspectExamStorage } = require('../../web/lib/exam-durable-storage.ts');

function replaceGlobal(name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    return () => {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
    };
}

test('ANS-06: penulisan snapshot cepat tetap selesai sesuai urutan perubahan', async () => {
    const events = [];
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });
    const writer = createSerializedWriter(async value => {
        events.push(`${value}:start`);
        if (value === 'first') await firstGate;
        events.push(`${value}:end`);
        return value;
    });

    const first = writer('first');
    const second = writer('second');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, ['first:start']);
    releaseFirst();
    assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
    assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
});

test('ANS-06: localStorage menjadi fallback terdeteksi ketika IndexedDB tidak tersedia', async () => {
    const values = new Map();
    const restoreIdb = replaceGlobal('indexedDB', undefined);
    const restoreLocal = replaceGlobal('localStorage', {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    });
    try {
        const health = await inspectExamStorage();
        assert.equal(health.available, true);
        assert.equal(health.mode, 'localstorage');
        assert.match(health.warning, /IndexedDB tidak tersedia/i);
    } finally {
        restoreLocal();
        restoreIdb();
    }
});

test('ANS-06: ujian diblokir bila IndexedDB dan fallback sama-sama ditolak', async () => {
    const restoreIdb = replaceGlobal('indexedDB', undefined);
    const restoreLocal = replaceGlobal('localStorage', {
        getItem: () => null,
        setItem: () => { throw new Error('storage denied'); },
        removeItem: () => {},
    });
    try {
        const health = await inspectExamStorage();
        assert.equal(health.available, false);
        assert.equal(health.mode, 'unavailable');
        assert.match(health.warning, /mode privat|browser lain/i);
    } finally {
        restoreLocal();
        restoreIdb();
    }
});

test('ANS-06: halaman ujian memakai preflight, restore, write, dan cleanup durable', () => {
    const source = fs.readFileSync(
        path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'),
        'utf8',
    );
    const storage = fs.readFileSync(
        path.resolve(__dirname, '../../web/lib/exam-durable-storage.ts'),
        'utf8',
    );

    assert.ok(source.indexOf('inspectExamStorage()') < source.indexOf('startExamAttemptAction('));
    assert.match(source, /readExamSnapshot\(result\.attempt\.id\)/);
    assert.match(source, /writeExamSnapshot\(att\.id/);
    assert.match(source, /removeExamSnapshot\(attempt\.id\)/);
    assert.ok(source.indexOf('resolveDurableDeviceId(getDeviceId())') < source.indexOf('startExamAttemptAction('));
    assert.match(storage, /await idbPut\(attemptId, legacy\)/);
    assert.match(storage, /navigator\.storage\.persist/);
    assert.match(storage, /MIN_FREE_BYTES/);
    assert.match(storage, /db\.transaction\(SETTINGS_STORE, 'readwrite'\)/);
});
