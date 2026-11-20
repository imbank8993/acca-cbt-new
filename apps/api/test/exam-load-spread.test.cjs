const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { jitteredInterval, nextDelay, QUESTION_CHECK_FALLBACK_MS } = require('../../web/lib/exam-timers.ts');
const web = file => fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');

test('nextDelay: periode ± spread', () => {
    assert.equal(nextDelay(15_000, 0.15, 0), 12_750);
    assert.equal(nextDelay(15_000, 0.15, 0.5), 15_000);
    assert.equal(nextDelay(15_000, 0.15, 1), 17_250);
});

test('jitteredInterval: putaran pertama acak dalam satu periode, lalu periode ± spread, dan dapat dihentikan', async () => {
    const samples = [0.2, 0, 1];
    const delays = [];
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (fn, delay) => { delays.push(delay); return realSetTimeout(fn, 0); };
    try {
        let runs = 0;
        let stop;
        await new Promise(resolve => {
            stop = jitteredInterval(() => { runs++; if (runs === 2) resolve(); }, 10_000, { spread: 0.1, random: () => samples.shift() ?? 0.5 });
        });
        stop();
        assert.deepEqual(delays.slice(0, 3), [2_000, 9_000, 11_000]);
        const before = runs;
        await new Promise(resolve => realSetTimeout(resolve, 10));
        assert.equal(runs, before, 'tidak berjalan lagi setelah dihentikan');
    } finally {
        global.setTimeout = realSetTimeout;
    }
});

test('heartbeat mengembalikan revisi soal di luar transaksi; halaman ujian memeriksa soal hanya saat revisi berubah', () => {
    const service = fs.readFileSync(path.resolve(__dirname, '../src/proctoring/proctoring.service.ts'), 'utf8');
    assert.match(service, /const result = await this\.db\.transaction\(async db => \{/);
    assert.match(service, /return \{ \.\.\.result, questionRevision: await this\.liveQuestionRevision\(attemptId\) \};/);
    assert.match(service, /metadata->>'live_question_revision'/);
    const page = web('app/components/questions/ExamPage.tsx');
    assert.doesNotMatch(page, /setInterval\(checkUpdates, 15000\)/, 'check-updates tidak lagi tiap 15 detik');
    assert.match(page, /jitteredInterval\(\(\) => \{ void checkUpdates\(\); \}, QUESTION_CHECK_FALLBACK_MS\)/);
    assert.match(page, /if \(known !== null && known !== revision\) requestQuestionCheckRef\.current\?\.\(\);/);
    assert.match(page, /const stop = jitteredInterval\(\(\) => \{ void pulse\(\); \}, 15_000\);/);
    assert.ok(QUESTION_CHECK_FALLBACK_MS >= 60_000);
    // Tidak ada lagi interval 15 detik tanpa jitter yang memanggil server dari halaman ujian.
    assert.doesNotMatch(page, /setInterval\([^)]*\b15_?000\)/);
});
