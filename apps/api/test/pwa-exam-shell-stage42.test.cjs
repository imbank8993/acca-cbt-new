// Run from repository root: node apps/api/test/pwa-exam-shell-stage42.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const swPath = path.resolve(__dirname, '../../web/public/exam-sw.js');
const sw = fs.readFileSync(swPath, 'utf8');
const pwa = fs.readFileSync(path.resolve(__dirname, '../../web/lib/exam-pwa.ts'), 'utf8');
const examPage = fs.readFileSync(
    path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'),
    'utf8',
);
const header = fs.readFileSync(
    path.resolve(__dirname, '../../web/app/components/Header.tsx'),
    'utf8',
);
const layout = fs.readFileSync(path.resolve(__dirname, '../../web/app/layout.tsx'), 'utf8');
const nextConfig = fs.readFileSync(path.resolve(__dirname, '../../web/next.config.ts'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../../web/public/manifest.webmanifest'),
    'utf8',
));

function serviceWorkerHarness({ fetchImpl, matchImpl } = {}) {
    const listeners = {};
    const sandbox = {
        URL,
        Request,
        Promise,
        fetch: fetchImpl || (async () => new Response('network')),
        caches: {
            keys: async () => [],
            delete: async () => true,
            match: matchImpl || (async () => null),
            open: async () => ({ put: async () => {}, delete: async () => true }),
        },
        self: {
            location: { origin: 'https://cbt.example.test' },
            addEventListener: (name, handler) => { listeners[name] = handler; },
            skipWaiting: async () => {},
            clients: {
                claim: async () => {},
                get: async () => ({ url: 'https://cbt.example.test/dashboard/siswa/exam/exam-1' }),
            },
        },
    };
    vm.runInNewContext(sw, sandbox, { filename: swPath });
    return listeners;
}

test('PWA-01: service worker hanya memulihkan navigasi route ujian siswa', async () => {
    const cached = new Response('<html>cached exam</html>', {
        headers: { 'content-type': 'text/html' },
    });
    const listeners = serviceWorkerHarness({
        fetchImpl: async () => { throw new Error('offline'); },
        matchImpl: async () => cached,
    });
    let responsePromise;
    listeners.fetch({
        request: {
            method: 'GET', mode: 'navigate', destination: 'document',
            url: 'https://cbt.example.test/dashboard/siswa/exam/exam-1',
        },
        respondWith: value => { responsePromise = value; },
    });
    assert.equal(await (await responsePromise).text(), '<html>cached exam</html>');
});

test('PWA-02: endpoint API tidak pernah dicegat atau disimpan', () => {
    const listeners = serviceWorkerHarness();
    let intercepted = false;
    listeners.fetch({
        request: {
            method: 'GET', mode: 'cors', destination: '',
            url: 'https://cbt.example.test/api/students/exams',
        },
        respondWith: () => { intercepted = true; },
    });
    assert.equal(intercepted, false);
    assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)\) return/);
});

test('PWA-03: respons redirect/login tidak boleh menggantikan shell ujian', () => {
    assert.match(sw, /response\.redirected\) return false/);
    assert.match(sw, /isExamPath\(finalUrl\.pathname\)/);
    assert.match(sw, /content-type[\s\S]*text\/html/);
});

test('PWA-04: cache aset hanya aktif untuk client yang sedang membuka ujian', () => {
    assert.match(sw, /self\.clients\.get\(event\.clientId\)/);
    assert.match(sw, /!isExamPath\(new URL\(client\.url\)\.pathname\)/);
    assert.match(sw, /url\.origin !== self\.location\.origin/);
});

test('PWA-05: cache shell mengikuti siklus recovery, submit, penolakan, dan logout', () => {
    assert.match(examPage, /cacheExamOfflineShell\(examId\)/);
    assert.ok((examPage.match(/removeExamOfflineShell\(examId\)/g) || []).length >= 3);
    assert.match(header, /clearExamOfflineShells\(\)/);
    assert.match(pwa, /CLEAR_EXAM_CACHES/);
});

test('PWA-06: aplikasi mendaftarkan worker dan manifest produksi', () => {
    assert.match(layout, /<ExamPwaRegistration \/>/);
    assert.match(layout, /manifest: "\/manifest\.webmanifest"/);
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/');
    assert.ok(manifest.icons.length > 0);
    assert.match(pwa, /NODE_ENV === 'production'/);
    assert.match(pwa, /navigator\.serviceWorker\.register\(SW_PATH/);
    assert.match(nextConfig, /Service-Worker-Allowed/);
    assert.match(nextConfig, /no-cache, no-store, must-revalidate/);
});
