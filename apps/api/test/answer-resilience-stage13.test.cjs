// Run from repository root: node --test apps/api/test/answer-resilience-stage13.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

require('ts-node').register({
    project: path.resolve(__dirname, '../../web/tsconfig.json'),
    transpileOnly: true,
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node' },
});

const { apiSend } = require('../../web/lib/api/client.ts');
const { examAutoRetryDelay } = require('../../web/lib/exam-retry.ts');

test('ANS-01: timeout benar-benar membatalkan request yang menggantung', async () => {
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
        const result = await apiSend('/api/test', { answer: 'A' }, 'PUT', { timeoutMs: 10 });
        assert.equal(aborted, true);
        assert.equal(result.success, false);
        assert.match(result.error, /batas waktu/i);
    } finally {
        global.fetch = originalFetch;
    }
});

test('ANS-01: endpoint jawaban memasang timeout autosave dan bulk sync', () => {
    const source = fs.readFileSync(
        path.resolve(__dirname, '../../web/lib/api/students.ts'),
        'utf8',
    );

    assert.match(source, /saveAnswerAction[\s\S]*timeoutMs: 15_000/);
    assert.match(source, /syncAnswersBulkAction[\s\S]*timeoutMs: 30_000/);
    assert.match(source, /submitExamAction[\s\S]*timeoutMs: 30_000/);
    assert.match(source, /beginSubmitAction[\s\S]*submit-intent/);
    assert.match(source, /const intent = await beginSubmitAction\(attemptId\)[\s\S]*if \(!intent\.success\)/);
});

test('ANS-01: Next.js forwards submit intent to the API', () => {
    const route = fs.readFileSync(
        path.resolve(__dirname, '../../web/app/api/students/attempts/[attemptId]/submit-intent/route.ts'),
        'utf8',
    );

    assert.match(route, /export async function POST/);
    assert.match(route, /proxyJson\([\s\S]*\/students\/attempts\/\$\{encodeURIComponent\(attemptId\)\}\/submit-intent/);
});

test('ANS-02: backoff auto-submit terus tersedia tanpa batas tiga percobaan', () => {
    assert.equal(examAutoRetryDelay(0), 10_000);
    assert.equal(examAutoRetryDelay(1), 20_000);
    assert.equal(examAutoRetryDelay(2), 30_000);
    assert.equal(examAutoRetryDelay(100), 30_000);

    const source = fs.readFileSync(
        path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'),
        'utf8',
    );
    assert.doesNotMatch(source, /autoRetryCountRef\.current\s*>=\s*3/);
    assert.match(source, /setWaitingForSyncAndSubmit\(Boolean\(opts\?\.isAuto\)\)/);
    assert.match(source, /examAutoRetryDelay\(autoRetryCountRef\.current\)/);
});

test('ANS-08: submit mengambil snapshot jawaban terbaru dari ref', () => {
    const source = fs.readFileSync(
        path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'),
        'utf8',
    );
    const handler = source.slice(
        source.indexOf('const handleSubmitExam'),
        source.indexOf('handleSubmitExamRef.current = handleSubmitExam'),
    );

    assert.match(handler, /submitExamAction\([\s\S]*answersRef\.current/);
    assert.doesNotMatch(handler, /Promise\.race/);
});
