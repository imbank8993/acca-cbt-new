// Run from repository root: node apps/api/test/read-timeout-stage25.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
    project: path.resolve(__dirname, '../../web/tsconfig.json'),
    transpileOnly: true,
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node' },
});

const { apiGet, DEFAULT_GET_TIMEOUT_MS } = require('../../web/lib/api/client.ts');

test('NET-01: GET yang menggantung dibatalkan oleh timeout', async () => {
    const originalFetch = global.fetch;
    let aborted = false;
    global.fetch = (_path, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
            aborted = true;
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
        }, { once: true });
    });

    try {
        const result = await apiGet('/api/test-read', { timeoutMs: 10 });
        assert.equal(aborted, true);
        assert.equal(result.success, false);
        assert.match(result.error, /batas waktu/i);
    } finally {
        global.fetch = originalFetch;
    }
});

test('NET-02: seluruh GET mendapat batas waktu default yang wajar', () => {
    assert.equal(DEFAULT_GET_TIMEOUT_MS, 15_000);
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/lib/api/client.ts'), 'utf8');
    assert.match(source, /options\.timeoutMs \?\? DEFAULT_GET_TIMEOUT_MS/);
});

test('NET-03: pesan timeout berlaku untuk semua halaman', async () => {
    const originalFetch = global.fetch;
    global.fetch = (_path, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });

    try {
        const result = await apiGet('/api/not-an-exam', { timeoutMs: 5 });
        assert.equal(result.success, false);
        assert.doesNotMatch(result.error, /jawaban/i);
        assert.match(result.error, /coba lagi/i);
    } finally {
        global.fetch = originalFetch;
    }
});

test('NET-04: pemanggil dapat memilih timeout lebih panjang untuk baca berat', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/lib/api/client.ts'), 'utf8');
    assert.match(source, /apiGet<T>\([\s\S]*options: ApiRequestOptions/);
});

test('NET-05: pemeriksaan sesi juga memiliki timeout', async () => {
    const originalFetch = global.fetch;
    const originalSetTimeout = global.setTimeout;
    let aborted = false;
    global.setTimeout = (callback, delay, ...args) =>
        originalSetTimeout(callback, delay === 10_000 ? 5 : delay, ...args);
    global.fetch = (_path, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
        }, { once: true });
    });

    try {
        const { getSessionUser, SESSION_REQUEST_TIMEOUT_MS } = require('../../web/lib/session.ts');
        assert.equal(SESSION_REQUEST_TIMEOUT_MS, 10_000);
        await assert.rejects(getSessionUser({ refresh: true }), /aborted/);
        assert.equal(aborted, true);
    } finally {
        global.fetch = originalFetch;
        global.setTimeout = originalSetTimeout;
    }
});

test('NET-06: gangguan sesi memakai cache dan tidak melewati otorisasi backend', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/lib/session.ts'), 'utf8');
    assert.match(source, /if \(cached\?\.user\) return cached.user/);
    assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), SESSION_REQUEST_TIMEOUT_MS\)/);
});
