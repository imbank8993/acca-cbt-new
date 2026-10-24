const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { AuthService } = require('../src/auth/auth.service.ts');
const { validateSyncHealth } = require('../src/common/exam-monitoring.ts');
const { attemptHealth } = require('../src/common/attempt-health.ts');
const web = file => fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');

// "Jaringan normal tetapi jawaban tidak terkirim": sesi login 12 jam habis di
// tengah ujian, atau server menolak jawaban. Sesi diperpanjang selama ujian,
// siswa diberi tahu bila sesi tetap berakhir, dan pengawas melihat penolakannya.
function auth({ activeAttempt = true, aktif = true, banned = null } = {}) {
    const issued = [];
    const prisma = { $queryRawUnsafe: async sql => /public\.users/.test(sql) ? [{ aktif }]
        : /cbt_exam_attempts/.test(sql) ? (activeAttempt ? [{ id: 'attempt' }] : []) : [] };
    const service = new AuthService(
        { findById: async id => ({ id, email: 'siswa@sekolah', raw_user_meta_data: { full_name: 'Siswa' }, banned_until: banned }) },
        { resolve: async () => ({ roleNames: ['Siswa'], resolved: [], bestRole: 'Siswa', organizationId: 'school', organizationName: 'Sekolah', isPlatformAdmin: false }) },
        { sign: payload => { issued.push(payload); return 'new-token'; } },
        { get: () => undefined }, {}, prisma, {}, { record: () => undefined },
    );
    return { service, issued };
}
const student = { id: 'student', email: 'siswa@sekolah', fullName: 'Siswa' };

test('the session is extended while the student has an attempt in progress', async () => {
    const { service, issued } = auth();
    const result = await service.refreshExamSession(student);
    assert.equal(result.access_token, 'new-token');
    assert.equal(issued[0].sub, 'student');
});

test('no extension outside an exam, or for a disabled account', async () => {
    await assert.rejects(auth({ activeAttempt: false }).service.refreshExamSession(student), /selama ujian sedang dikerjakan/);
    await assert.rejects(auth({ aktif: false }).service.refreshExamSession(student), /dinonaktifkan/);
    await assert.rejects(auth({ banned: '2099-01-01T00:00:00Z' }).service.refreshExamSession(student), /dinonaktifkan/);
});

test('a 401 is reported as an ended session, including on submission', async () => {
    const original = { fetch: global.fetch, window: global.window, localStorage: global.localStorage };
    global.window = {};
    global.localStorage = { getItem: () => 'device', setItem: () => {} };
    global.fetch = async () => new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401 });
    try {
        const { apiSend } = require('../../web/lib/api/client.ts');
        const failed = await apiSend('/api/x', {});
        assert.equal(failed.unauthorized, true);
        assert.equal(failed.retryable, false);
        const { submitExamAction, SESSION_ENDED_MESSAGE } = require('../../web/lib/api/students.ts');
        const submit = await submitExamAction('exam', { q: 'a' }, undefined, 'attempt', { q: 1 });
        assert.equal(submit.success, false);
        assert.equal(submit.error, SESSION_ENDED_MESSAGE);
        assert.match(SESSION_ENDED_MESSAGE, /walaupun jaringan normal/);
    } finally {
        global.fetch = original.fetch;
        if (original.window === undefined) delete global.window; else global.window = original.window;
        if (original.localStorage === undefined) delete global.localStorage; else global.localStorage = original.localStorage;
    }
});

test('the device reports server rejections and monitoring shows them while connected', () => {
    const health = validateSyncHealth({ localAnswerCount: 21, pendingAnswerCount: 9, storageState: 'healthy',
        rejection: 'Ujian ditarik oleh proktor. Jawaban baru tidak dapat disimpan.' });
    assert.equal(health.rejection, 'Ujian ditarik oleh proktor. Jawaban baru tidak dapat disimpan.');
    assert.throws(() => validateSyncHealth({ localAnswerCount: 1, pendingAnswerCount: 1, storageState: 'healthy', rejection: 'x'.repeat(201) }));
    const now = new Date('2026-10-24T01:00:00Z');
    const attempt = { id: 'a', status: 'in_progress', last_seen_at: '2026-10-24T00:59:55Z', started_at: '2026-10-24T00:00:00Z',
        personal_end_time: '2026-10-24T02:00:00Z', metadata: { sync_health: { ...health, receivedAt: '2026-10-24T00:59:55Z' } } };
    const result = attemptHealth(attempt, {}, [], now, 30);
    assert.ok(result.attention_reasons.includes('Jawaban ditolak server: Ujian ditarik oleh proktor. Jawaban baru tidak dapat disimpan.'));
    assert.equal(result.sync_health.rejection, health.rejection);
});

test('the exam page refreshes the session, explains an ended session and reports rejections', () => {
    const page = web('app/components/questions/ExamPage.tsx');
    assert.match(page, /refreshExamSessionAction\(\)/);
    assert.match(page, /setInterval\(refresh, 30 \* 60_000\)/);
    assert.match(page, /else if \(res\.unauthorized\) setSyncRejection\(SESSION_ENDED_MESSAGE\)/);
    assert.match(page, /Sesi login berakhir — jawaban belum terkirim/);
    assert.match(page, /rejection: syncRejectionRef\.current\.slice\(0, 200\)/);
    assert.match(page, /heartbeat\.retryable === false\) \{[\s\S]{0,200}noteSyncResult\(heartbeat\)/);
    assert.match(web('app/api/auth/refresh/route.ts'), /'\/auth\/refresh'/);
});
