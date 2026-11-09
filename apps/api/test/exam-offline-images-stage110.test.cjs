// Run from repository root: node --test apps/api/test/exam-offline-images-stage110.test.cjs
// Gambar soal berkas (/api/storage/file/) disimpan service worker agar tetap tampil saat offline.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { examImageUrls } = require('../../web/lib/exam-offline-images.ts');

const web = (relative) => fs.readFileSync(path.resolve(__dirname, '../../web', relative), 'utf8');
const swPath = path.resolve(__dirname, '../../web/public/exam-sw.js');
const sw = fs.readFileSync(swPath, 'utf8');
const ORIGIN = 'https://cbt.example.test';

function harness({ cached = {}, fetchImpl } = {}) {
    const listeners = {};
    const store = new Map(Object.entries(cached)); // cacheName -> Map(url -> Response)
    const sandbox = {
        URL, Request, Response, Promise,
        fetch: fetchImpl || (async () => new Response('network', { headers: { 'content-type': 'image/png' } })),
        caches: {
            keys: async () => [...store.keys()],
            delete: async (name) => store.delete(name),
            match: async () => null,
            open: async (name) => {
                if (!store.has(name)) store.set(name, new Map());
                const entries = store.get(name);
                return {
                    match: async (url) => entries.get(typeof url === 'string' ? url : url.url) || null,
                    put: async (url, response) => { entries.set(typeof url === 'string' ? url : url.url, response); },
                    keys: async () => [...entries.keys()].map(url => new Request(url)),
                    delete: async (request) => entries.delete(typeof request === 'string' ? request : request.url),
                };
            },
        },
        self: {
            location: { origin: ORIGIN },
            addEventListener: (name, handler) => { listeners[name] = handler; },
            skipWaiting: async () => {},
            clients: { claim: async () => {}, get: async () => null },
        },
    };
    vm.runInNewContext(sw, sandbox, { filename: swPath });
    return { listeners, store };
}

function dispatchFetch(listeners, url, destination) {
    let response = null;
    listeners.fetch({
        request: { method: 'GET', mode: 'no-cors', destination, url },
        respondWith: (value) => { response = value; },
    });
    return response;
}

test('OFFIMG-01: URL gambar berkas dikumpulkan dari seluruh isi soal, tanpa duplikat', () => {
    const questions = [{
        question_text: `<p>Soal</p><img src="${ORIGIN}/api/storage/file/banks/b1/images/img_a.png" width="170">`,
        metadata: { image_url: '/api/storage/file/users/u1/questions/1_x.JPG', audio: '/api/storage/file/users/u1/questions-audio/a.mp3' },
        bank_question_options: [
            { option_text: '<img src="/api/storage/file/banks/b1/images/img_a.png">' },
            { option_text: '<img src="/api/storage/file/banks/b1/equations/eq_1.svg?v=1&amp;x=2">' },
            { option_text: '<img src="https://evil.example/api/storage/file/banks/b1/images/x.png">' },
            { option_text: '<img src="data:image/png;base64,AAAA">' },
        ],
        stimulus: { content: '<img src="/api/storage/file/banks/b1/images/img_b.webp#frag">' },
    }];
    assert.deepEqual(examImageUrls(questions, ORIGIN).sort(), [
        `${ORIGIN}/api/storage/file/banks/b1/equations/eq_1.svg?v=1&x=2`,
        `${ORIGIN}/api/storage/file/banks/b1/images/img_a.png`,
        `${ORIGIN}/api/storage/file/banks/b1/images/img_b.webp`,
        `${ORIGIN}/api/storage/file/users/u1/questions/1_x.JPG`,
    ]);
    assert.deepEqual(examImageUrls([{ question_text: '<p>tanpa gambar</p>' }], ORIGIN), []);
});

test('OFFIMG-02: worker menyajikan gambar tersimpan tanpa ke server; yang tidak tersimpan lewat jaringan', async () => {
    const url = `${ORIGIN}/api/storage/file/banks/b1/images/img_a.png`;
    let network = 0;
    const { listeners } = harness({
        cached: { 'acca-exam-shell-v2:images:/dashboard/siswa/exam/e1': new Map([[url, new Response('cached')]]) },
        fetchImpl: async () => { network++; return new Response('network'); },
    });
    assert.equal(await (await dispatchFetch(listeners, url, 'image')).text(), 'cached');
    assert.equal(network, 0);
    assert.equal(await (await dispatchFetch(listeners, `${ORIGIN}/api/storage/file/banks/b1/images/lain.png`, 'image')).text(), 'network');
    assert.equal(network, 1);
});

test('OFFIMG-03: hanya permintaan GAMBAR yang dicegat; audio, fetch, dan API lain tidak', () => {
    const { listeners } = harness();
    for (const [url, destination] of [
        [`${ORIGIN}/api/storage/file/users/u1/questions-audio/a.mp3`, 'audio'],
        [`${ORIGIN}/api/storage/file/banks/b1/images/img_a.png`, ''],
        [`${ORIGIN}/api/students/exams`, ''],
        [`${ORIGIN}/api/storage/upload`, 'image'],
    ]) assert.equal(dispatchFetch(listeners, url, destination), null, `${destination || 'fetch'} ${url}`);
    assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)\) return/);
});

test('OFFIMG-04: CACHE_EXAM_IMAGES menyimpan gambar sah saja, memangkas yang lama, menolak path non-ujian', async () => {
    const stale = `${ORIGIN}/api/storage/file/banks/b1/images/lama.png`;
    const fetched = [];
    const { listeners, store } = harness({
        cached: { 'acca-exam-shell-v2:images:/dashboard/siswa/exam/e1': new Map([[stale, new Response('old')]]) },
        fetchImpl: async (request) => {
            fetched.push(new URL(request.url).pathname);
            if (request.url.endsWith('ditolak.png')) return new Response('{}', { status: 403, headers: { 'content-type': 'application/json' } });
            return new Response('png', { headers: { 'content-type': 'image/png' } });
        },
    });
    const send = (data) => new Promise(resolve => {
        let pending;
        listeners.message({ data, ports: [{ postMessage: resolve }], waitUntil: (p) => { pending = p; } });
        return pending;
    });
    const reply = await send({ type: 'CACHE_EXAM_IMAGES', path: '/dashboard/siswa/exam/e1', images: [
        '/api/storage/file/banks/b1/images/baru.png', '/api/storage/file/banks/b1/images/ditolak.png',
        '/api/storage/file/x/audio.mp3', 'https://evil.example/api/storage/file/a.png',
    ] });
    assert.equal(reply.success, false, 'satu gambar ditolak server dilaporkan');
    assert.deepEqual(fetched.sort(), ['/api/storage/file/banks/b1/images/baru.png', '/api/storage/file/banks/b1/images/ditolak.png']);
    assert.deepEqual([...store.get('acca-exam-shell-v2:images:/dashboard/siswa/exam/e1').keys()].map(String),
        [`${ORIGIN}/api/storage/file/banks/b1/images/baru.png`]);
    assert.equal((await send({ type: 'CACHE_EXAM_IMAGES', path: '/dashboard/guru', images: [] })).success, false);
});

test('OFFIMG-05: siklus hidup cache gambar mengikuti ujian (submit, logout, pembaruan worker)', () => {
    const examPage = web('app/components/questions/ExamPage.tsx');
    assert.match(examPage, /void cacheExamOfflineImages\(examId, loadedQuestions, \{ jitterMs: 8_000 \}\)/);
    assert.match(examPage, /void cacheExamOfflineImages\(examId, next\)/, 'soal yang diperbarui ikut disimpan');
    assert.match(sw, /await caches\.delete\(imageCacheName\(url\.pathname\)\)/, 'UNCACHE (submit) menghapus gambar ujian');
    assert.match(sw, /CLEAR_EXAM_CACHES[\s\S]*name\.startsWith\(OWNED_CACHE_PREFIX\)/, 'logout menghapus semua cache ujian');
    assert.match(sw, /!name\.startsWith\(IMAGE_CACHE_PREFIX\)/, 'pembaruan worker tidak menghapus gambar ujian yang berjalan');
    const pwa = web('lib/exam-pwa.ts');
    assert.match(pwa, /type: 'CACHE_EXAM_IMAGES'/);
    assert.match(pwa, /EXAM_CACHE_PREFIX = 'acca-exam-shell-'/, 'pembersihan langsung saat logout mencakup cache gambar');
});
