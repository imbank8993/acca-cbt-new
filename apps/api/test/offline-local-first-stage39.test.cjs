// Run from repository root: node apps/api/test/offline-local-first-stage39.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const examPage = fs.readFileSync(
    path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'),
    'utf8',
);
const storage = fs.readFileSync(
    path.resolve(__dirname, '../../web/lib/exam-durable-storage.ts'),
    'utf8',
);

test('OFFLINE-01: perubahan jawaban menunggu penyimpanan lokal sebelum request server', () => {
    const handler = examPage.slice(
        examPage.indexOf('const handleAnswerSelect'),
        examPage.indexOf('const toggleDoubtful'),
    );
    assert.match(handler, /const localWrite = await writeExamSnapshot/);
    assert.ok(handler.indexOf('await writeExamSnapshot') < handler.indexOf('saveAnswerAction'));
});

test('OFFLINE-02: browser offline tidak menunggu timeout autosave HTTP', () => {
    const handler = examPage.slice(
        examPage.indexOf('const handleAnswerSelect'),
        examPage.indexOf('const toggleDoubtful'),
    );
    assert.match(handler, /if \(!navigator\.onLine \|\| offlineRecoveryRef\.current\) \{[\s\S]*markFailed\(questionId, true\);[\s\S]*return;/);
    assert.ok(handler.indexOf('if (!navigator.onLine || offlineRecoveryRef.current)') < handler.indexOf('saveAnswerAction'));
});

test('OFFLINE-03: sinkronisasi membaca snapshot setelah antrean tulis selesai', () => {
    const reader = storage.slice(
        storage.indexOf('export async function readExamSnapshot'),
        storage.indexOf('export async function removeExamSnapshot'),
    );
    assert.match(reader, /snapshotTails\.get\(attemptId\)/);
    assert.match(reader, /if \(pendingWrite\) await pendingWrite/);
    assert.ok(reader.indexOf('await pendingWrite') < reader.indexOf('idbGet(attemptId)'));
});

test('OFFLINE-04: auto-submit menunggu konfirmasi sinkronisasi jawaban', () => {
    assert.match(examPage, /const answersSynced = waitingForSyncAndSubmit\s*\?\s*true\s*:\s*await syncPendingAnswers\(\)/);
    assert.match(examPage, /waitingForSyncAndSubmit && answersSynced/);
    assert.match(examPage, /await handleSubmitExam\(undefined, \{ isAuto: true \}\)/);
    assert.match(examPage, /submitExamAction\([\s\S]*answersRef\.current/);
    assert.match(examPage, /const syncPendingAnswers = useCallback\(async \(\): Promise<boolean>/);
});

test('OFFLINE-05: pemulihan berkala tidak bergantung pada event online', () => {
    assert.match(examPage, /if \(!waitingForSyncAndSubmit \|\| !attempt\?\.id \|\| isCompleted\) return/);
    assert.match(examPage, /const interval = setInterval\(\(\) => \{ void retry\(\); \}, 15_000\)/);
    assert.match(examPage, /Object\.keys\(answers\)\.length} jawaban tersimpan di perangkat/);
});
