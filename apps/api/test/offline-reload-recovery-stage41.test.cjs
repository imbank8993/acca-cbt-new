// Run from repository root: node --test apps/api/test/offline-reload-recovery-stage41.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('ts-node').register({
    project: path.resolve(__dirname, '../../web/tsconfig.json'),
    transpileOnly: true,
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node' },
});

const { validateExamRecoverySession } = require('../../web/lib/exam-durable-storage.ts');
const examPage = fs.readFileSync(
    path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'),
    'utf8',
);
const studentApi = fs.readFileSync(
    path.resolve(__dirname, '../../web/lib/api/students.ts'),
    'utf8',
);
const storage = fs.readFileSync(
    path.resolve(__dirname, '../../web/lib/exam-durable-storage.ts'),
    'utf8',
);

function recovery(overrides = {}) {
    return {
        examId: 'exam-1',
        attemptId: 'attempt-1',
        userId: 'student-1',
        deviceId: 'device-1',
        user: { id: 'student-1', email: 'student@example.test' },
        profile: { full_name: 'Siswa', identity_number: '1001' },
        exam: { id: 'exam-1', title: 'Ujian' },
        attempt: { id: 'attempt-1', status: 'in_progress' },
        questions: [{ id: 'question-1' }],
        deadlineAt: 2_000_000,
        lastQuestionIndex: 0,
        cachedAt: new Date(1_000_000).toISOString(),
        ...overrides,
    };
}

test('RECLOAD-01: paket sah hanya untuk ujian, siswa, dan perangkat yang sama', () => {
    const checked = validateExamRecoverySession(recovery(), {
        examId: 'exam-1', userId: 'student-1', deviceId: 'device-1', now: 1_500_000,
    });
    assert.equal(checked.valid, true);
    assert.equal(checked.session.attemptId, 'attempt-1');
});

test('RECLOAD-02: cache siswa atau perangkat lain ditolak', () => {
    assert.deepEqual(
        validateExamRecoverySession(recovery(), {
            examId: 'exam-1', userId: 'student-2', deviceId: 'device-1', now: 1_500_000,
        }),
        { valid: false, reason: 'user' },
    );
    assert.deepEqual(
        validateExamRecoverySession(recovery(), {
            examId: 'exam-1', userId: 'student-1', deviceId: 'device-2', now: 1_500_000,
        }),
        { valid: false, reason: 'device' },
    );
    assert.deepEqual(
        validateExamRecoverySession(recovery({ attemptId: 'attempt-tampered' }), {
            examId: 'exam-1', userId: 'student-1', deviceId: 'device-1', now: 1_500_000,
        }),
        { valid: false, reason: 'invalid' },
    );
});

test('RECLOAD-03: deadline absolut tidak dapat diperpanjang lewat reload', () => {
    assert.deepEqual(
        validateExamRecoverySession(recovery(), {
            examId: 'exam-1', userId: 'student-1', deviceId: 'device-1', now: 2_000_000,
        }),
        { valid: false, reason: 'expired' },
    );
    assert.match(examPage, /session\.deadlineAt - Date\.now\(\)/);
});

test('RECLOAD-04: fallback cache hanya dipakai untuk kegagalan jaringan yang retryable', () => {
    assert.match(studentApi, /retryable: res\.retryable === true/);
    assert.match(examPage, /detail\.retryable && await restoreOfflineSession/);
    assert.match(examPage, /qRes\.retryable && await restoreOfflineSession/);
    assert.match(examPage, /result\.retryable && await restoreOfflineSession/);
    assert.match(examPage, /Penolakan eksplisit server[\s\S]*removeExamRecoverySession/);
});

test('RECLOAD-05: sinkronisasi terkunci sampai server mengakui attempt yang sama', () => {
    assert.match(examPage, /if \(!att\?\.id \|\| offlineRecoveryRef\.current\) return false/);
    assert.match(examPage, /if \(!navigator\.onLine \|\| offlineRecoveryRef\.current\) \{[\s\S]*setWaitingForSyncAndSubmit\(true\)/);
    assert.match(examPage, /result\.attempt\?\.id !== localAttempt\.id/);
    assert.ok(
        examPage.indexOf('await revalidateOfflineSession()') <
        examPage.indexOf('Promise.all([syncPendingAnswers(), flushSecurityEvents()])'),
    );
});

test('RECLOAD-06: cache menyimpan paket soal, attempt, deadline, dan posisi terakhir', () => {
    assert.match(storage, /RECOVERY_SESSION_STORE = 'recovery-sessions'/);
    assert.match(examPage, /writeExamRecoverySession\(\{/);
    assert.match(examPage, /questions: loadedQuestions/);
    assert.match(examPage, /deadlineAt: deadlineRef\.current/);
    assert.match(examPage, /updateExamRecoveryPosition\(examId, currentQIndex\)/);
});

test('RECLOAD-07: paket soal dibersihkan setelah submit dan logout', () => {
    const header = fs.readFileSync(
        path.resolve(__dirname, '../../web/app/components/Header.tsx'),
        'utf8',
    );
    assert.match(examPage, /removeExamRecoverySession\(examId\)/);
    assert.match(header, /clearExamRecoverySessions\(\)/);
});
