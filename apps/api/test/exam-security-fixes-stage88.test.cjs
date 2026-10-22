const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { fileServingHeaders, canUploadSvg } = require('../src/storage/storage-file-policy.ts');
const { StorageController } = require('../src/storage/storage.controller.ts');
const { StorageAccessService } = require('../src/storage/storage-access.service.ts');
const { normalizeAssignmentSubmission } = require('../src/common/assignment-submission.ts');
const { RateLimiter } = require('../src/common/rate-limit.ts');
const { AuthController, loginFailures } = require('../src/auth/auth.controller.ts');
const { clientContextChange, MONITORING_EVENTS } = require('../src/common/exam-monitoring.ts');
const { NON_WARNING_EVENTS } = require('../src/common/student-security-events.ts');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const { ProctoringService } = require('../src/proctoring/proctoring.service.ts');
const { UnauthorizedException } = require('@nestjs/common');

const examId = '11111111-1111-4111-8111-111111111111';
const student = { id: 'student', roles: ['SISWA'] };
const teacher = { id: 'teacher', roles: ['GURU'] };
const device = 'test-device';

// ── #1 berkas aktif ──────────────────────────────────────────────────────
test('#1 served uploads are sandboxed; non-media types download; PDF keeps viewer', () => {
    assert.match(fileServingHeaders('image/svg+xml')['Content-Security-Policy'], /sandbox/);
    assert.equal(fileServingHeaders('image/svg+xml')['Content-Disposition'], undefined);
    assert.equal(fileServingHeaders('application/zip')['Content-Disposition'], 'attachment');
    assert.equal(fileServingHeaders('text/html')['Content-Disposition'], 'attachment');
    assert.equal(fileServingHeaders('application/pdf')['Content-Security-Policy'], undefined);
    assert.equal(fileServingHeaders('application/pdf')['X-Content-Type-Options'], 'nosniff');
});

test('#1 students cannot upload SVG; staff and internal services can', async () => {
    assert.equal(canUploadSvg(student), false);
    assert.equal(canUploadSvg(teacher), true);
    assert.equal(canUploadSvg(null), true);
    let stored;
    const storage = { resolveContentType: () => 'image/svg+xml', generateFileName: () => 'x.svg',
        putObject: async key => { stored = key; return { success: true, key, url: '/api/storage/file/' + key }; } };
    const controller = new StorageController(storage);
    const svg = { originalname: 'x.svg', size: 10, buffer: Buffer.from('<svg><script>alert(1)</script></svg>') };
    await assert.rejects(controller.upload(student, svg, 'avatars'), e => e.getStatus() === 400);
    assert.equal(stored, undefined);
    await controller.upload(teacher, svg, 'questions');
    assert.equal(stored, 'users/teacher/questions/x.svg');
});

test('#1 file gateway response carries sandbox header', async () => {
    const headers = {};
    const controller = new StorageController({ getObject: async () => ({ contentType: 'image/svg+xml', stream: { pipe() {} } }) },
        { assertRead: async () => undefined });
    await controller.serveFile({ url: '/storage/file/users/student/questions/x.svg' }, { setHeader: (k, v) => headers[k] = v }, student);
    assert.match(headers['Content-Security-Policy'], /sandbox/);
});

// ── #11 folder tugas ─────────────────────────────────────────────────────
test('#11 assignment uploads require an active attempt or exam staff', async () => {
    const db = fixtureDb({ cbt_exam_attempts: [{ id: 'a', exam_id: examId, user_id: 'student', status: 'in_progress' }] });
    let staffChecked = 0;
    const access = new StorageAccessService(db, { assertExamStaff: async () => { staffChecked++; throw Object.assign(new Error('no'), { getStatus: () => 403 }); } }, {});
    await access.assertAssignmentUpload(student, examId);
    assert.equal(staffChecked, 0);
    await assert.rejects(access.assertAssignmentUpload({ id: 'stranger' }, examId));
    assert.equal(staffChecked, 1);
    await assert.rejects(access.assertAssignmentUpload(student, '../other'), e => e.getStatus() === 403);
});

// ── #2 data tugas ────────────────────────────────────────────────────────
test('#2 assignment payload is shape-checked and stripped of unknown keys', () => {
    const owner = { examId, userId: 'student' };
    assert.deepEqual(normalizeAssignmentSubmission({ fileUrls: ['/api/storage/file/a.pdf'], textSubmission: 'ok', extra: { x: 1 } }, owner),
        { fileUrls: ['/api/storage/file/a.pdf'], textSubmission: 'ok' });
    assert.equal(normalizeAssignmentSubmission(undefined, owner), undefined);
    for (const bad of [{ fileUrls: 'abc' }, { fileUrls: [{}] }, { fileUrls: ['javascript:alert(1)'] },
        { videoUrl: 'data:text/html,x' }, { documentUrl: 5 }, { textSubmission: { a: 1 } }, ['x'],
        { fileUrls: Array.from({ length: 21 }, (_, i) => `/f${i}.pdf`) }, { textSubmission: 'x'.repeat(20_001) }]) {
        assert.throws(() => normalizeAssignmentSubmission(bad, owner), e => e.getStatus() === 400, JSON.stringify(bad).slice(0, 60));
    }
    // Tautan tanpa skema tetap diterima: siswa sering menulis "youtu.be/..." tanpa https.
    assert.equal(normalizeAssignmentSubmission({ videoUrl: 'youtu.be/abc' }, owner).videoUrl, 'youtu.be/abc');
});

// ── #6 rate limit & login ────────────────────────────────────────────────
test('#6 limiter blocks past the limit and recovers after the window', () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    for (let i = 0; i < 3; i++) assert.equal(limiter.hit('k', 3, 1000), 0);
    assert.ok(limiter.hit('k', 3, 1000) > 0);
    now = 1001;
    assert.equal(limiter.hit('k', 3, 1000), 0);
});

test('#6 repeated failed logins lock the account temporarily; success resets', async () => {
    loginFailures.reset('account:victim@x.test');
    let password = 'wrong';
    const controller = new AuthController({ login: async (_e, p) => {
        if (p !== 'right' || password !== 'right') throw new UnauthorizedException('Email atau password salah.');
        return { token: 't' };
    } });
    const req = { ip: '203.0.113.1', headers: {} };
    for (let i = 0; i < 10; i++) {
        await assert.rejects(controller.login({ email: 'Victim@x.test', password: 'wrong' }, req), e => e.getStatus() === 401);
    }
    password = 'right';
    await assert.rejects(controller.login({ email: 'victim@x.test', password: 'right' }, req), e => e.getStatus() === 429);
    loginFailures.reset('account:victim@x.test');
    assert.deepEqual(await controller.login({ email: 'victim@x.test', password: 'right' }, req), { token: 't' });
});

// ── #3 jejak perpindahan perangkat ───────────────────────────────────────
test('#3 context change is detected and never counted as a violation', async () => {
    assert.equal(clientContextChange(undefined, { browser: 'Chrome 131', os: 'Windows', ip_address: '1.1.1.1' }), null);
    assert.deepEqual(clientContextChange({ browser: 'Chrome 131', os: 'Windows', ip_address: '1.1.1.1' },
        { browser: 'Firefox 132', os: 'Windows', ip_address: '1.1.1.1' }).fields, ['browser']);
    for (const event of ['CLIENT_CONTEXT_CHANGED', 'SCREEN_SHARE_UNCONFIRMED']) {
        assert.ok(MONITORING_EVENTS.includes(event));
        assert.ok(NON_WARNING_EVENTS.includes(event));
    }
    const db = fixtureDb({
        cbt_exams: [{ id: 'e', metadata: { screenshot_enabled: true } }],
        cbt_exam_attempts: [{ id: 'a', exam_id: 'e', user_id: 's', status: 'in_progress', device_fingerprint: device, metadata: {} }],
    }, [], { now: '2026-09-20T00:00:00Z' });
    const service = new ProctoringService(db, {}, {});
    await service.heartbeat({ id: 's' }, 'a', device, undefined, { browser: 'Chrome 131', os: 'Windows', ip_address: '192.0.2.1' }, true);
    await service.heartbeat({ id: 's' }, 'a', device, undefined, { browser: 'Chrome 131', os: 'Android', ip_address: '192.0.2.9' }, false);
    await service.heartbeat({ id: 's' }, 'a', device, undefined, { browser: 'Chrome 131', os: 'Android', ip_address: '192.0.2.9' }, false);
    const events = (db.tables.cbt_attempt_security_logs || []).map(row => row.event_type);
    assert.deepEqual(events.filter(e => e === 'CLIENT_CONTEXT_CHANGED').length, 1);
    assert.deepEqual(events.filter(e => e === 'SCREEN_SHARE_UNCONFIRMED').length, 1, 'logged once per change');
});

// ── #7 #8 #9 jalur pengerjaan ────────────────────────────────────────────
function examFixture(examPatch = {}, now = '2026-09-20T00:30:00Z') {
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', organization_id: 'school', is_published: true, metadata: { is_public: true },
            end_time: '2026-09-20T01:00:00Z', ...examPatch }],
        cbt_organization_members: [{ user_id: student.id, organization_id: 'school', is_active: true }],
        cbt_exam_attempts: [{ id: 'attempt', user_id: student.id, exam_id: 'exam', status: 'in_progress',
            started_at: '2026-09-20T00:00:00Z', personal_end_time: '2026-09-20T01:00:00Z', device_fingerprint: device, metadata: {} }],
        cbt_exam_question_snapshots: [{ exam_id: 'exam', question_snapshot: { id: 'q', type: 'essay', bank_question_options: [] } }],
        cbt_answers: [],
    }, [], { now });
    const service = new ExamAttemptsService(db, { post: async () => ({ items: [], scaled_score: 0, needs_manual_grading: true }) }, {});
    return { db, service };
}

test('#7 oversized answers are refused before touching the database', async () => {
    const { db, service } = examFixture();
    await assert.rejects(service.saveAnswer(student, 'attempt', { questionId: 'q', essay_answer: 'x'.repeat(100_001), revision: 1 }, device),
        e => e.getStatus() === 400);
    await assert.rejects(service.submit(student, 'exam', { q: 'x'.repeat(100_001) }, undefined, 'attempt', device), e => e.getStatus() === 400);
    assert.equal(db.tables.cbt_answers.length, 0);
});

test('#8 a payload-less submit intent is never refreshed', async () => {
    const { db, service } = examFixture();
    let now = '2026-09-20T00:58:00Z';
    db.raw = async sql => /clock_timestamp|select now/i.test(sql) ? [{ now: new Date(now) }] : [{ id: 'locked' }];
    const first = await service.beginSubmit(student, 'attempt', device);
    now = '2026-09-20T00:59:30Z';
    const second = await service.beginSubmit(student, 'attempt', device);
    assert.equal(second.startedAt, first.startedAt);
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.submit_intent_at, first.startedAt);
    // Intent tanpa isi tidak menunda penutupan setelah batas waktu.
    now = '2026-09-20T01:00:10Z';
    const result = await service.start(student, 'exam', device);
    assert.equal(result.started, false);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'auto_submitted');
});

test('#9 withdrawn exam refuses new answers but still accepts the submission', async () => {
    const { db, service } = examFixture({ is_published: false });
    await assert.rejects(service.saveAnswer(student, 'attempt', { questionId: 'q', essay_answer: 'late', revision: 1 }, device),
        e => e.getStatus() === 403);
    const result = await service.submit(student, 'exam', {}, undefined, 'attempt', device);
    assert.equal(result.alreadySubmitted, false);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
});

test('#9 key correction in progress blocks autosave', async () => {
    const { service } = examFixture({ metadata: { is_public: true, key_correction: { state: 'pending' } } });
    await assert.rejects(service.syncAnswers(student, 'attempt', [{ questionId: 'q', essay_answer: 'x', revision: 1 }], device),
        e => e.getStatus() === 409);
});

test('#2 submit stores the normalized assignment and verifies it', async () => {
    const { db, service } = examFixture();
    const result = await service.submit(student, 'exam', {}, { fileUrls: ['/api/storage/file/a.pdf'], junk: 'x' }, 'attempt', device);
    assert.deepEqual(db.tables.cbt_exam_attempts[0].metadata.assignment_submission, { fileUrls: ['/api/storage/file/a.pdf'] });
    assert.equal(result.submissionVerified, true);
    await assert.rejects(examFixture().service.submit(student, 'exam', {}, { fileUrls: ['javascript:alert(1)'] }, 'attempt', device),
        e => e.getStatus() === 400);
});

// ── #10 susulan ──────────────────────────────────────────────────────────
for (const released of [true, false]) {
    test(`#10 makeup ${released ? 'refused after' : 'allowed before'} answer keys are visible`, async () => {
        const db = fixtureDb({
            cbt_exams: [{ id: 'exam', show_results: true, end_time: '2026-09-20T01:00:00Z', metadata: { show_answer_keys: released } }],
            cbt_exam_attempts: [{ id: 'attempt', exam_id: 'exam', user_id: 's', status: 'submitted', personal_end_time: '2026-09-20T01:00:00Z', metadata: {} }],
            cbt_answers: [{ id: 'ans', attempt_id: 'attempt', question_id: 'q' }],
        }, [], { now: '2026-09-20T02:00:00Z' });
        const service = new ProctoringService(db, { assertExamStaff: async () => undefined }, {});
        const run = service.startMakeupAttempt(teacher, 'attempt', 'Sakit saat ujian', 60);
        if (released) {
            await assert.rejects(run, e => e.getStatus() === 400);
            assert.equal(db.tables.cbt_answers.length, 1);
            assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
        } else {
            await run;
            assert.equal(db.tables.cbt_exam_attempts[0].status, 'in_progress');
        }
    });
}

// ── Screenshot pelanggaran ───────────────────────────────────────────────
const { ExamScreenshotsService, screenshotKey, encryptScreenshot } = require('../src/proctoring/exam-screenshots.service.ts');
const { Readable } = require('node:stream');
const jpeg = Buffer.from([255, 216, 255, 224, 0, 0, 255, 217]);
function screenshotFixture(config = { JWT_SECRET: 'a-long-encryption-secret-for-tests' }) {
    const now = Date.now();
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', metadata: { screenshot_enabled: true } }],
        cbt_exam_attempts: [{ id: 'attempt', user_id: 'student', exam_id: 'exam', device_fingerprint: device, status: 'in_progress' }],
        cbt_attempt_security_logs: ['right_click_attempt', 'copy_paste_attempt', 'restricted_shortcut', 'right_click_attempt', 'tab_switch']
            .map((type, i) => ({ id: `ev-${i}`, attempt_id: 'attempt', event_type: type, created_at: new Date(now).toISOString(),
                metadata: { client_event_id: `c-${i}`, source: 'student', timestamp: new Date(now - (10 - i) * 60_000).toISOString() } })),
    }, [], { now: new Date(now).toISOString() });
    const images = new Map();
    const storage = { status: () => ({ configured: true }), putObject: async (k, b) => { images.set(k, b); return { success: true }; },
        deleteObject: async k => { images.delete(k); return { success: true }; },
        getObject: async k => images.has(k) ? { stream: Readable.from([images.get(k)]) } : null };
    const service = new ExamScreenshotsService(db, { assertExamMonitoring: async () => undefined }, storage, { get: name => config[name] });
    return { db, images, service };
}

test('#6 minor events use at most 3 screenshots so serious violations keep evidence', async () => {
    const { service } = screenshotFixture();
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await service.upload({ id: 'student' }, 'attempt', `c-${i}`, device, jpeg.toString('base64')));
    assert.deepEqual(results.map(r => r.saved ? 'saved' : r.reason), ['saved', 'saved', 'saved', 'minor_limit', 'saved']);
});

test('#3 production refuses evidence without a dedicated key; legacy evidence stays readable', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
        const legacy = screenshotFixture();
        await assert.rejects(legacy.service.upload({ id: 'student' }, 'attempt', 'c-4', device, jpeg.toString('base64')), e => e.getStatus() === 503);
        assert.equal(legacy.images.size, 0);
        // Bukti lama (dienkripsi turunan JWT_SECRET) tetap bisa dibuka setelah kunci khusus dipasang.
        const migrated = screenshotFixture({ JWT_SECRET: 'a-long-encryption-secret-for-tests', SCREENSHOT_ENCRYPTION_KEY: 'a-dedicated-evidence-key-1234567890' });
        migrated.images.set('exam-evidence/old.bin', encryptScreenshot(jpeg, screenshotKey('a-long-encryption-secret-for-tests')));
        migrated.db.tables.cbt_exam_screenshots = [{ id: 'old', attempt_id: 'attempt', object_key: 'exam-evidence/old.bin',
            content_type: 'image/jpeg', expires_at: '2099-01-01', deleted_at: null }];
        assert.deepEqual((await migrated.service.read({ id: 'guard' }, 'old')).body, jpeg);
        const saved = await migrated.service.upload({ id: 'student' }, 'attempt', 'c-4', device, jpeg.toString('base64'));
        assert.equal(saved.saved, true);
        assert.deepEqual((await migrated.service.read({ id: 'guard' }, saved.id)).body, jpeg);
    } finally { process.env.NODE_ENV = previous; }
});

test('#1 a lasting screen-share loss is a counted violation, unlike the informational stop record', async () => {
    assert.ok(!NON_WARNING_EVENTS.includes('screen_share_lost'));
    assert.ok(NON_WARNING_EVENTS.includes('SCREEN_SHARE_STOPPED'));
    const db = fixtureDb({
        cbt_exams: [{ id: 'e', metadata: { max_violations: 5 } }],
        cbt_exam_attempts: [{ id: 'a', exam_id: 'e', user_id: 's', status: 'in_progress', metadata: {} }],
    });
    const service = new ProctoringService(db, {}, {});
    await service.logViolation({ id: 's' }, 'a', 'SCREEN_SHARE_STOPPED', {}, '22222222-2222-4222-8222-222222222222');
    const result = await service.logViolation({ id: 's' }, 'a', 'screen_share_lost', {}, '33333333-3333-4333-8333-333333333333');
    assert.equal(result.warningCount, 1);
});

test('#1 stopped screen sharing blocks answer changes until sharing resumes', async () => {
    const { db, service } = examFixture({ metadata: { is_public: true, screenshot_enabled: true } });
    db.tables.cbt_exam_attempts[0].metadata.screen_share_confirmed = false;
    await assert.rejects(service.saveAnswer(student, 'attempt', { questionId: 'q', essay_answer: 'x', revision: 1 }, device),
        e => e.getStatus() === 403 && e.getResponse().code === 'SCREEN_SHARE_REQUIRED');
    db.tables.cbt_exam_attempts[0].metadata.screen_share_confirmed = true;
    await service.saveAnswer(student, 'attempt', { questionId: 'q', essay_answer: 'x', revision: 1 }, device);
    assert.equal(db.tables.cbt_answers[0].essay_answer, 'x');
    const result = await service.submit(student, 'exam', { q: 'x' }, undefined, 'attempt', device, { q: 1 });
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
    assert.equal(result.alreadySubmitted, false);
});

test('#1 browser hook: only an ended track stops sharing; mute is not treated as stopping', () => {
    const fs = require('node:fs');
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/hooks/useExamScreenshots.ts'), 'utf8');
    const onmute = source.slice(source.indexOf('track.onmute'), source.indexOf('track.onunmute'));
    assert.doesNotMatch(onmute, /setSharing\(false\)|sharingRef\.current = false/);
    assert.doesNotMatch(source, /setSharing\(!track\.muted\)/);
    const endedHandler = source.slice(source.indexOf('track.onended = () =>'), source.indexOf('track.onmute = () =>'));
    assert.match(endedHandler, /stop\(\)/);
});

test('#1 heartbeat restores the lock state as soon as sharing resumes', async () => {
    const db = fixtureDb({
        cbt_exams: [{ id: 'e', metadata: { screenshot_enabled: true } }],
        cbt_exam_attempts: [{ id: 'a', exam_id: 'e', user_id: 's', status: 'in_progress', device_fingerprint: device, metadata: {} }],
    });
    const service = new ProctoringService(db, {}, {});
    await service.heartbeat({ id: 's' }, 'a', device, undefined, undefined, false, undefined, '2026-10-22T09:00:00.000Z');
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.screen_share_confirmed, false);
    await service.heartbeat({ id: 's' }, 'a', device, undefined, undefined, true, undefined, '2026-10-22T09:00:02.000Z');
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.screen_share_confirmed, true);
    await service.heartbeat({ id: 's' }, 'a', device, undefined, undefined, false, undefined, '2026-10-22T09:00:01.000Z');
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.screen_share_confirmed, true);
});
