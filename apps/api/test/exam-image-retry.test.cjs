const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { imageRetryDelay, IMAGE_RETRY_DELAYS_MS, IMAGE_RETRY_MAX } = require('../../web/lib/exam-image-retry.ts');
const web = file => fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');

test('broken question images are retried with growing, jittered delays and a finite budget', () => {
    assert.deepEqual(IMAGE_RETRY_DELAYS_MS.map((_, i) => imageRetryDelay(i, () => 0.5)), IMAGE_RETRY_DELAYS_MS);
    // Jitter ±25% so hundreds of students do not retry in the same second.
    assert.equal(imageRetryDelay(0, () => 0), 1_500);
    assert.equal(imageRetryDelay(0, () => 1), 2_500);
    // After the table, the last (longest) delay repeats.
    assert.equal(imageRetryDelay(50, () => 0.5), 60_000);
    const total = Array.from({ length: IMAGE_RETRY_MAX }, (_, i) => imageRetryDelay(i, () => 0.5)).reduce((a, b) => a + b, 0);
    assert.ok(total >= 5 * 60_000 && total <= 10 * 60_000, `retry window ${total} ms`);
});

test('exam page retries failed images in place and re-caches images that failed to download', () => {
    const retry = web('lib/exam-image-retry.ts');
    assert.match(retry, /addEventListener\('error', onError, true\)/, 'capture phase sees images inside question HTML');
    assert.match(retry, /src\.includes\(STORAGE_FILE\)/, 'only question file images are retried');
    assert.match(retry, /addEventListener\('online', onOnline\)/);
    const page = web('app/components/questions/ExamPage.tsx');
    assert.match(page, /useEffect\(\(\) => installExamImageRetry\(document\), \[\]\);/);
    assert.match(page, /cacheExamOfflineImagesWithRetry\(examId, loadedQuestions, \(\) => !cancelled, \{ jitterMs: 8_000 \}\)/);
    const pwa = web('lib/exam-pwa.ts');
    assert.match(pwa, /if \(await cacheExamOfflineImages\(examId, questions, options\)\) return true;/);
    assert.match(pwa, /if \(!isActive\(\)\) return false;/);
});
