const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { imageRetryDelay, classifyImageStatus, installExamImageRetry, IMAGE_FAILURE_TEXT, IMAGE_RETRY_DELAYS_MS, IMAGE_RETRY_MAX } = require('../../web/lib/exam-image-retry.ts');
const web = file => fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');

test('broken question images are retried with growing, jittered delays and a finite budget', () => {
    assert.deepEqual(IMAGE_RETRY_DELAYS_MS.map((_, i) => imageRetryDelay(i, () => 0.5)), IMAGE_RETRY_DELAYS_MS);
    assert.equal(imageRetryDelay(0, () => 0), 1_500);
    assert.equal(imageRetryDelay(0, () => 1), 2_500);
    assert.equal(imageRetryDelay(50, () => 0.5), 60_000);
    const total = Array.from({ length: IMAGE_RETRY_MAX }, (_, i) => imageRetryDelay(i, () => 0.5)).reduce((a, b) => a + b, 0);
    assert.ok(total >= 5 * 60_000 && total <= 10 * 60_000, `retry window ${total} ms`);
});

test('every failure status maps to a distinct recovery path', () => {
    assert.deepEqual([null, 0, 500, 502, 503, 504, 408, 429].map(classifyImageStatus), Array(8).fill('transient'));
    assert.equal(classifyImageStatus(200), 'ok');
    assert.equal(classifyImageStatus(401), 'auth');
    assert.equal(classifyImageStatus(403), 'forbidden');
    assert.equal(classifyImageStatus(404), 'missing');
});

// Elemen <img> dan dokumen tiruan secukupnya untuk menjalankan pemulihan di Node.
class FakeImg {
    constructor(src) { this.attrs = { src }; this.dataset = {}; this.isConnected = true; this.complete = true; this.naturalWidth = 0; this.alt = ''; this.title = ''; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    removeAttribute(name) { delete this.attrs[name]; }
    get src() { return this.attrs.src; }
    set src(value) { this.attrs.src = value; }
}
function setup(status, contentType = 'image/png') {
    global.HTMLImageElement = FakeImg;
    const listeners = {};
    const doc = { images: [], defaultView: null, addEventListener: (type, fn) => { listeners[type] = fn; }, removeEventListener: () => undefined };
    let authCalls = 0, fetches = 0;
    const fetchImpl = async () => { fetches++; return new Response(status === 200 ? new Blob(['x']) : null, { status, headers: { 'content-type': contentType } }); };
    const controller = installExamImageRetry(doc, { fetchImpl, onAuthFailure: () => { authCalls++; } });
    const img = new FakeImg('/api/storage/file/users/t/questions/a.png');
    doc.images.push(img);
    const fail = async () => { listeners.error({ target: img }); await new Promise(resolve => setTimeout(resolve, 5)); };
    return { img, fail, controller, counts: () => ({ authCalls, fetches }) };
}

test('404 shows a clear message and stops retrying', async () => {
    const { img, fail, controller } = setup(404);
    await fail();
    assert.equal(img.dataset.imageState, 'missing');
    assert.equal(img.alt, IMAGE_FAILURE_TEXT.missing);
    controller.dispose();
});

test('403 shows a clear message and only retries slowly', async () => {
    const { img, fail, controller } = setup(403);
    await fail();
    assert.equal(img.dataset.imageState, 'forbidden');
    assert.equal(img.dataset.imageForbidden, '1');
    controller.dispose();
});

test('401 asks the exam page to renew the session once and keeps retrying', async () => {
    const { img, fail, controller, counts } = setup(401);
    await fail(); await fail();
    assert.equal(img.dataset.imageState, 'auth');
    assert.equal(counts().authCalls, 1, 'sesi diperpanjang sekali, bukan per gambar');
    controller.dispose();
});

test('when the server returns the image but <img> still failed, the downloaded copy is shown', async () => {
    const { img, fail, controller } = setup(200);
    await fail();
    assert.match(img.src, /^blob:/);
    assert.equal(img.dataset.imageSource, '/api/storage/file/users/t/questions/a.png');
    controller.dispose();
});

test('server overload (503) is retried, not marked as missing', async () => {
    const { img, fail, controller } = setup(503);
    await fail();
    assert.equal(img.dataset.imageState, undefined);
    assert.equal(img.dataset.imageRetry, '1');
    controller.dispose();
});

test('exam page wires session renewal to image failures and re-caches images that failed to download', () => {
    const page = web('app/components/questions/ExamPage.tsx');
    assert.match(page, /installExamImageRetry\(document, \{[\s\S]*?refreshExamSessionAction\(\)[\s\S]*?images\.retryAll\(\)[\s\S]*?setSyncRejection\(SESSION_ENDED_MESSAGE\)/);
    assert.match(page, /cacheExamOfflineImagesWithRetry\(examId, loadedQuestions, \(\) => !cancelled, \{ jitterMs: 8_000 \}\)/);
    assert.match(web('app/globals.css'), /img\[data-image-state\]/);
    const pwa = web('lib/exam-pwa.ts');
    assert.match(pwa, /if \(await cacheExamOfflineImages\(examId, questions, options\)\) return true;/);
});
