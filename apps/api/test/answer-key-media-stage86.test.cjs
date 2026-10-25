const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { assertAnswerKeysReleased } = require('../src/common/answer-key-release.ts');
const { StorageAccessService } = require('../src/storage/storage-access.service.ts');
const { StorageController } = require('../src/storage/storage.controller.ts');
const { StorageService } = require('../src/storage/storage.service.ts');
const { DbService } = require('../src/prisma/prisma-db-adapter.ts');
const { fileKey, isPublicFile } = require('../src/storage/storage-file-policy.ts');
const { StudentsService } = require('../src/students/students.service.ts');
const { ExamReviewService } = require('../src/analytics/exam-review.service.ts');
const user = { id: 'student', roles: ['SISWA'] };
const image = 'users/teacher/questions/item.png', explanation = 'users/teacher/questions/key.png';
const url = key => `/api/storage/file/${key}`;
function fixture() {
    const exam = { id: 'exam', organization_id: 'school', question_bank_id: 'bank', is_published: true,
        show_results: true, start_time: '2026-09-20T00:00:00Z', end_time: '2026-09-20T01:00:00Z',
        metadata: { is_public: true, show_answer_keys: false } };
    const question = { id: 'q', bank_id: 'bank', type: 'mcq', question_text: `<img src="${url(image)}">`,
        metadata: { explanation: `<img src="${url(explanation)}">` },
        bank_question_options: [{ id: 'answer', is_correct: true, option_text: 'answer' }] };
    const db = fixtureDb({ cbt_exams: [exam],
        cbt_organization_members: [{ user_id: user.id, organization_id: 'school', is_active: true }],
        cbt_exam_attempts: [{ id: 'attempt', exam_id: 'exam', user_id: user.id, status: 'in_progress',
            started_at: exam.start_time, personal_end_time: exam.end_time, metadata: {}, exams: exam }],
        cbt_exam_question_snapshots: [{ exam_id: 'exam', question_snapshot: question }],
        cbt_bank_questions: [question], cbt_answers: [],
    }, [], { now: '2026-09-20T00:30:00Z' });
    const storage = Object.create(StorageService.prototype);
    Object.assign(storage, { publicUrl: 'https://files.example.test', bucket: 'bucket', accountId: 'account' });
    return { db, storage, access: new StorageAccessService(db, {}, storage) };
}
const denied = e => e.getStatus?.() === 403;
for (const scenario of ['not-enabled', 'future-end', 'no-end', 'active-recovery']) {
    test(`answer key release blocks ${scenario}`, async () => {
        const { db } = fixture();
        const exam = db.tables.cbt_exams[0];
        exam.metadata.show_answer_keys = scenario !== 'not-enabled';
        if (scenario !== 'future-end') exam.end_time = '2026-09-20T00:00:00Z';
        if (scenario === 'no-end') exam.end_time = null;
        if (scenario === 'active-recovery') db.tables.cbt_exam_attempts[0].metadata.proctor_recovery_until = '2026-09-20T01:00:00Z';
        await assert.rejects(assertAnswerKeysReleased(db, exam), denied);
    });
}
test('score summary stays available while detailed keys are blocked', async () => {
    const { db } = fixture();
    db.tables.cbt_exam_attempts[0].status = 'submitted';
    db.tables.cbt_exam_attempts[0].total_score = 80;
    assert.equal((await new StudentsService(db).listResults(user))[0].total_score, 80);
    const summary = await new StudentsService(db).getAttemptDetails(user, 'attempt');
    assert.equal(summary.attempt.total_score, 80);
    assert.equal(summary.answerKeysReleased, false);
    assert.deepEqual(summary.answers, []);
    assert.equal(summary.attempt.exams.metadata, undefined);
    await assert.rejects(new ExamReviewService(db, {}).getReview(user, 'attempt'), denied);
});
test('released details retain frozen exam keys after the bank key changes', async () => {
    const { db } = fixture();
    const attempt = db.tables.cbt_exam_attempts[0];
    attempt.status = 'submitted';
    attempt.exams.metadata.show_answer_keys = true;
    attempt.exams.end_time = '2026-09-20T00:00:00Z';
    db.tables.cbt_answers.push({ id: 'a', attempt_id: 'attempt', question_id: 'q',
        bank_questions: { id: 'q', metadata: { answer: 'LATEST' }, bank_question_options: [] } });
    const result = await new StudentsService(db).getAttemptDetails(user, 'attempt');
    assert.equal(result.answers[0].question.metadata.answer, undefined);
    assert.equal(result.answers[0].question.options[0].id, 'answer');
});
test('active participant may read displayed image but not key/explanation or foreign files', async () => {
    const { access } = fixture();
    await access.assertRead(user, image);
    for (const key of [explanation, image + '.other', 'users/other/questions/private.png']) {
        await assert.rejects(access.assertRead(user, key), denied);
    }
});
for (const state of ['missing', 'expired', 'recovery', 'submitted']) {
    test(`attachment denied for ${state} session`, async () => {
        const { db, access } = fixture();
        const attempt = db.tables.cbt_exam_attempts[0];
        if (state === 'missing') db.tables.cbt_exam_attempts = [];
        if (state === 'expired') attempt.personal_end_time = '2026-09-20T00:00:00Z';
        if (state === 'recovery') attempt.metadata.recovery_submit_only = true;
        if (state === 'submitted') attempt.status = 'submitted';
        await assert.rejects(access.assertRead(user, image), denied);
    });
}
test('released participant can read explanation media after exam ends', async () => {
    const { db, access } = fixture();
    db.tables.cbt_exam_attempts[0].status = 'submitted';
    db.tables.cbt_exams[0].end_time = '2026-09-20T00:00:00Z';
    db.tables.cbt_exams[0].metadata.show_answer_keys = true;
    await access.assertRead(user, explanation);
});
test('anonymous file request cannot reach storage; allowed response is private', async () => {
    const { access } = fixture(); let reads = 0; const headers = {};
    const controller = new StorageController({ getObject: async () => { reads++; return { contentType: 'image/png', stream: { pipe() {} } }; } }, access);
    const req = { url: '/storage/file/' + image }, res = { setHeader: (key, value) => headers[key] = value };
    await assert.rejects(controller.serveFile(req, res, null), denied);
    assert.equal(reads, 0);
    await controller.serveFile(req, res, user);
    assert.equal(headers['Cache-Control'], 'private, no-store');
});
test('private URLs always use gateway, including legacy HTML on configured domain', () => {
    const { storage } = fixture();
    assert.equal(storage.publicUrlForKey(image), url(image));
    assert.equal(storage.protectUrls(`<img src="https://files.example.test/${image}">`), `<img src="${url(image)}">`);
    assert.equal(storage.protectUrls('https://unrelated.test/a.png'), 'https://unrelated.test/a.png');
    assert.equal(isPublicFile(image), false);
    assert.equal(isPublicFile('users/teacher/avatars/a.png'), true);
    for (const raw of ['avatars/../questions/a.png', 'avatars/%2e%2e/questions/a.png', '%252e%252e/questions/a.png']) {
        assert.throws(() => fileKey('/storage/file/' + raw));
    }
});


test('HTTP media guard rejects anonymous and internal-key callers but streams to authorized student', async t => {
    const { Test } = require('@nestjs/testing');
    const { PassportModule } = require('@nestjs/passport');
    const { Strategy } = require('passport-strategy');
    const passport = require('passport');
    const { Readable } = require('node:stream');
    class TestStrategy extends Strategy {
        constructor() { super(); this.name = 'jwt'; }
        authenticate(req) {
            if (req.headers.authorization === 'Bearer test-student') this.success(user);
            else this.fail(401);
        }
    }
    passport.use(new TestStrategy());
    t.after(() => passport.unuse('jwt'));
    const { access, db } = fixture();
    const moduleRef = await Test.createTestingModule({
        imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
        controllers: [StorageController],
        providers: [
            { provide: StorageService, useValue: { getObject: async () => ({ contentType: 'image/png', stream: Readable.from(['image']) }) } },
            { provide: StorageAccessService, useValue: access },
            { provide: DbService, useValue: db },
        ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    t.after(() => app.close());
    const base = await app.getUrl();
    for (const headers of [{}, { 'x-internal-key': 'not-a-user' }]) {
        assert.equal((await fetch(`${base}/storage/file/${image}`, { headers })).status, 401);
    }
    const response = await fetch(`${base}/storage/file/${image}`, { headers: { Authorization: 'Bearer test-student' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(await response.text(), 'image');
    assert.equal((await fetch(`${base}/storage/file/avatars/public.png`)).status, 200);
});


test('private attachment links render without allowing arbitrary relative or script URLs', () => {
    const { safeExternalUrl } = require('../../web/lib/safe-url.ts');
    assert.equal(safeExternalUrl(url(image)), url(image));
    for (const link of ['javascript:alert(1)', '//evil.test/file', '/admin', '/api/storage/file/../../admin']) {
        assert.equal(safeExternalUrl(link), '');
    }
});
