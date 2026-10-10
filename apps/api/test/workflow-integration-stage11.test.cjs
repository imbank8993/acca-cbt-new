// Run from repository root: node --test apps/api/test/workflow-integration-stage11.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { Test } = require('@nestjs/testing');
const { UnauthorizedException, ValidationPipe } = require('@nestjs/common');
const { fixtureDb } = require('./fixture-db.cjs');
const { JwtAuthGuard } = require('../src/auth/jwt-auth.guard.ts');
const { StudentsController } = require('../src/students/students.controller.ts');
const { StudentsService } = require('../src/students/students.service.ts');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const { ExamReviewService } = require('../src/analytics/exam-review.service.ts');
const { QuestionsService } = require('../src/questions/questions.service.ts');

const student = { id: 'student', isPlatformAdmin: false };
const otherStudent = { id: 'student-other', isPlatformAdmin: false };
const deviceId = 'device-integration-01';

function workflowTables() {
    return {
        cbt_exams: [{
            id: 'exam', organization_id: 'school', question_bank_id: null,
            title: 'Ujian Integrasi', is_published: true, exam_type: 'daily',
            start_time: '2026-09-19T00:00:00Z', end_time: '2026-09-21T00:00:00Z',
            duration_minutes: 60, randomize_questions: false, randomize_options: false,
            show_results: true, metadata: { is_public: true }, subjects: { name: 'Integrasi' },
        }],
        cbt_exam_question_sources: [{ exam_id: 'exam', bank_id: 'bank' }],
        cbt_question_banks: [{ id: 'bank', organization_id: 'school', created_by: 'teacher' }],
        cbt_bank_questions: [{
            id: 'question', bank_id: 'bank', question_text: 'Dua tambah dua?',
            type: 'mcq', score_default: 1, difficulty: 'easy',
            created_at: '2026-01-01T00:00:00Z', metadata: { order_index: 0 },
            bank_question_options: [
                { id: 'wrong', question_id: 'question', option_text: '3', order: 0, is_correct: false },
                { id: 'correct', question_id: 'question', option_text: '4', order: 1, is_correct: true },
            ],
        }],
        cbt_bank_question_options: [
            { id: 'wrong', question_id: 'question', option_text: '3', order: 0, is_correct: false },
            { id: 'correct', question_id: 'question', option_text: '4', order: 1, is_correct: true },
        ],
        cbt_exam_attempts: [], cbt_answers: [], cbt_exam_attempt_questions: [],
        cbt_attempt_security_logs: [],
        cbt_organization_members: [
            { user_id: student.id, organization_id: 'school', is_active: true },
            { user_id: otherStudent.id, organization_id: 'school', is_active: true },
        ],
        cbt_class_members: [], cbt_additional_class_members: [], cbt_exam_participants: [],
    };
}

function scoringStub() {
    return {
        post: async (_path, body) => {
            const items = body.items.map(item => {
                const correct = item.raw_answer === 'correct';
                return {
                    answer_id: item.answer_id,
                    question_id: item.question.id,
                    score: correct ? 1 : 0,
                    is_correct: correct,
                    dimension_scores: {},
                };
            });
            const total = items.reduce((sum, item) => sum + item.score, 0);
            return {
                items, total_score: total, max_possible_score: body.items.length,
                scaled_score: body.items.length ? total / body.items.length * 100 : 0,
                needs_manual_grading: false, dimension_scores: {},
            };
        },
    };
}

test('QA-02 / BUG-11: start, render, autosave, submit, review, and historical delete stay coherent', async () => {
    const db = fixtureDb(workflowTables(), [], { now: '2026-09-20T00:00:00Z' });
    const attempts = new ExamAttemptsService(db, scoringStub(), { applyRelativeQuizScoring: async () => ({}) });

    const started = await attempts.start(student, 'exam', deviceId);
    assert.equal(started.started, true);
    const attemptId = started.attempt.id;

    const rendered = await attempts.getQuestions(student, 'exam', deviceId);
    assert.deepEqual(rendered.questions.map(question => question.id), ['question']);
    assert.equal('is_correct' in rendered.questions[0].bank_question_options[1], false);

    await assert.rejects(
        attempts.saveAnswer(otherStudent, attemptId, { questionId: 'question', selected_option_id: 'wrong' }, deviceId),
        error => error.getStatus?.() === 403,
    );
    await attempts.saveAnswer(student, attemptId, { questionId: 'question', selected_option_id: 'correct' }, deviceId);

    const submitted = await attempts.submit(
        student, 'exam', { question: 'correct' }, undefined, attemptId, deviceId,
    );
    assert.equal(submitted.score, 100);
    assert.equal(db.tables.cbt_exam_attempts[0].status, 'submitted');
    assert.equal(db.tables.cbt_answers[0].selected_option_id, 'correct');

    // Fixture relasi menyimpan nested row secara eksplisit; service review tetap
    // menjalankan query dan perhitungan aslinya pada state hasil submit di atas.
    db.tables.cbt_exams[0].end_time = '2026-09-19T23:59:00Z';
    db.tables.cbt_exams[0].metadata.show_answer_keys = true;
    db.tables.cbt_exam_attempts[0].exams = structuredClone(db.tables.cbt_exams[0]);
    const reviewService = new ExamReviewService(db, { assertExamStaff: async () => {} });
    const beforeDelete = await reviewService.getReview(student, attemptId);
    assert.equal(beforeDelete.summary.totalQuestions, 1);
    assert.equal(beforeDelete.summary.percentage, 100);

    const questions = new QuestionsService(
        db,
        { assertBankAccess: async () => 'school', assertBankAccessByChild: async () => 'school' },
        { regradeExamAttemptsByQuestion: async () => {} },
    );
    const removed = await questions.remove({ id: 'teacher' }, 'question', 'bank');
    assert.equal(removed.softDeleted, true);
    assert.equal(db.tables.cbt_answers.length, 1);
    assert.equal(db.tables.cbt_bank_question_options.length, 2);

    const afterDelete = await reviewService.getReview(student, attemptId);
    assert.equal(afterDelete.summary.totalQuestions, 1);
    assert.equal(afterDelete.summary.percentage, 100);
});

test('QA-02: HTTP contract validates DTOs and takes identity from the guard', async t => {
    let submittedArgs;
    const attemptsMock = {
        submit: async (...args) => { submittedArgs = args; return { score: 100 }; },
    };
    const moduleRef = await Test.createTestingModule({
        controllers: [StudentsController],
        providers: [
            { provide: StudentsService, useValue: {} },
            { provide: ExamAttemptsService, useValue: attemptsMock },
        ],
    })
        .overrideGuard(JwtAuthGuard)
        .useValue({
            canActivate(context) {
                const request = context.switchToHttp().getRequest();
                const userId = request.headers['x-test-user'];
                if (!userId) throw new UnauthorizedException('Token wajib diisi.');
                request.user = { id: userId, isPlatformAdmin: false };
                return true;
            },
        })
        .compile();

    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    t.after(() => app.close());

    const port = app.getHttpServer().address().port;
    const examId = '11111111-1111-4111-8111-111111111111';
    const attemptId = '22222222-2222-4222-8222-222222222222';
    const url = `http://127.0.0.1:${port}/api/students/exams/${examId}/submit`;

    const unauthorized = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answers: {} }),
    });
    assert.equal(unauthorized.status, 401);

    const invalid = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': 'student' },
        body: JSON.stringify({ answers: [], deviceId: 'short' }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(submittedArgs, undefined);

    const valid = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': 'student' },
        body: JSON.stringify({
            answers: { question: 'correct' }, attemptId, deviceId,
            userId: 'forged-user', organizationId: 'forged-school',
        }),
    });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { score: 100 });
    assert.equal(submittedArgs[0].id, 'student');
    assert.equal(submittedArgs[1], examId);
    assert.deepEqual(submittedArgs[2], { question: 'correct' });
    assert.equal(submittedArgs[4], attemptId);
});

test('QA-02 / BUG-09: snapshot lokal selesai sebelum server autosave', () => {
    const source = fs.readFileSync(
        path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'),
        'utf8',
    );
    const handler = source.slice(
        source.indexOf('const handleAnswerSelect'),
        source.indexOf('const toggleDoubtful'),
    );
    assert.match(handler, /const localWrite = await writeExamSnapshot\(att\.id/);
    assert.match(handler, /await saveAnswerAction\(/);
    assert.ok(handler.indexOf('await saveAnswerAction(') > handler.indexOf('await writeExamSnapshot('));
    assert.match(handler, /if \(!localWrite\.saved\)/);
});

test('QA-02: every P1 audit finding is linked to an existing regression test', () => {
    const root = path.resolve(__dirname, '../../..');
    const findings = JSON.parse(
        fs.readFileSync(path.join(root, 'docs/audit-2026-09-19/findings.json'), 'utf8'),
    );
    const coverage = JSON.parse(fs.readFileSync(
        path.join(root, 'docs/perbaikan-2026-09-19/p1-test-coverage.json'),
    ));
    const expected = findings.filter(finding => finding.priority === 'P1').map(finding => finding.id).sort();
    assert.deepEqual(Object.keys(coverage).sort(), expected);
    for (const [id, entry] of Object.entries(coverage)) {
        assert.ok(entry.scenario?.trim(), `${id} belum memiliki skenario`);
        assert.ok(entry.tests?.length, `${id} belum memiliki tautan tes`);
        for (const relative of entry.tests) {
            assert.ok(fs.existsSync(path.join(root, relative)), `${id}: tes tidak ditemukan: ${relative}`);
        }
    }
});
