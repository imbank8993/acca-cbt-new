const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { GradingService } = require('../src/grading/grading.service.ts');
const { TeachersService } = require('../src/teachers/teachers.service.ts');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const { QuestionsService } = require('../src/questions/questions.service.ts');
const { GradingRetryWorker } = require('../src/grading/grading-retry.worker.ts');
const { loadFrozenExamQuestions } = require('../src/common/exam-question-snapshots.ts');
const q = { id: 'q', type: 'mcq', score_default: 1, bank_question_options: [{ id: 'o', is_correct: true }] };
function fixture(failed = []) {
  return fixtureDb({
    cbt_exams: [{ id: 'exam', exam_type: 'quiz', organization_id: 'school', is_published: true, metadata: { is_public: true }, end_time: '2026-09-20T01:00:00Z' }],
    cbt_organization_members: [{ user_id: 'student', organization_id: 'school', is_active: true }],
    cbt_exam_attempts: [{ id: 'a', exam_id: 'exam', user_id: 'student', status: 'submitted', total_score: 100, metadata: { base_score: 100 }, started_at: '2026-09-20T00:00:00Z', finished_at: '2026-09-20T00:20:00Z', personal_end_time: '2026-09-20T01:00:00Z', device_fingerprint: 'device-original' }],
    cbt_exam_question_snapshots: [{ id: 's', exam_id: 'exam', question_id: 'q', order_number: 1, question_snapshot: q }],
    cbt_answers: [{ id: 'ans', attempt_id: 'a', question_id: 'q', selected_option_id: 'o', essay_answer: null, score: 1, is_correct: true }],
  }, failed, { now: '2026-09-20T00:30:00Z' });
}
const batch = (score) => ({ items: [{ answer_id: 'ans', question_id: 'q', score, is_correct: !!score, dimension_scores: {} }], total_score: score, max_possible_score: 1, scaled_score: score * 100, dimension_scores: {} });

const response = score => ({ ...batch(score), items: [{ ...batch(score).items[0], answer_id: 'q' }] });
const staff = { assertExamStaff: async () => {} };
const noRelative = { applyRelativeQuizScoringIfQuiz: async () => ({}) };

test('bank edits preserve finished and active exam snapshots and do not trigger regrade', async () => {
    const db = fixture();
    db.tables.cbt_bank_questions = [{ ...q, bank_id: 'bank', revision: 1 }];
    const before = structuredClone(db.tables.cbt_exam_question_snapshots);
    await new QuestionsService(db, { assertBankAccess: async () => 'school' }, {
        regradeExamAttemptsByQuestion: () => assert.fail('bank edits must not regrade historical exams'),
    }).save({ id: 'teacher' }, { id: 'q', bankId: 'bank', expectedRevision: 1,
        type: 'mcq', questionText: 'Edited bank', scoreDefault: 5, metadata: {} });
    assert.equal(db.tables.cbt_bank_questions[0].score_default, 5);
    assert.deepEqual(db.tables.cbt_exam_question_snapshots, before);
});

test('failed answer read preserves scores and never calls scoring', async () => {
    const db = fixture(['cbt_answers']);
    await assert.rejects(new GradingService(db, {}, { post: () => assert.fail('must not score missing data') }).regradeAttempt('a'));
    assert.equal(db.tables.cbt_exam_attempts[0].total_score, 100);
    assert.equal(db.writes.length, 0);
});

test('an unselected option in a frozen exam cannot be deleted by a bank edit', async () => {
    const db = fixture(); db.tables.cbt_answers = [];
    db.tables.cbt_bank_questions = [{ ...q, bank_id: 'bank', revision: 1 }];
    db.tables.cbt_bank_question_options = [{ id: 'o', question_id: 'q', option_text: 'Original' }];
    const before = structuredClone(db.tables);
    await assert.rejects(new QuestionsService(db, { assertBankAccess: async () => 'school' }, {}).save({ id: 'teacher' }, {
        id: 'q', bankId: 'bank', expectedRevision: 1, type: 'mcq', questionText: 'Changed', scoreDefault: 1, options: [],
    }), /snapshot ujian/);
    assert.deepEqual(db.tables, before);
});

test('snapshot creation rereads options after waiting for a concurrent bank edit', async () => {
    const db = fixture(); db.tables.cbt_exam_attempts = []; db.tables.cbt_exam_question_snapshots = [];
    db.tables.cbt_exams[0].question_bank_id = 'bank';
    db.tables.cbt_bank_questions = [{ ...q, bank_id: 'bank' }];
    const raw = db.raw;
    db.raw = async (sql, ...params) => {
        if (sql.includes('FOR SHARE')) db.tables.cbt_bank_questions[0].bank_question_options = [{ id: 'replacement', is_correct: true }];
        return raw(sql, ...params);
    };
    const questions = await loadFrozenExamQuestions(db, 'exam');
    assert.equal(questions[0].bank_question_options[0].id, 'replacement');
    assert.equal(db.tables.cbt_exam_question_snapshots[0].question_snapshot.bank_question_options[0].id, 'replacement');
});

test('a frozen question is soft-deleted even before any participant starts', async () => {
    const db = fixture(); db.tables.cbt_exam_attempts = []; db.tables.cbt_answers = [];
    db.tables.cbt_bank_questions = [{ ...q, bank_id: 'bank', metadata: {} }];
    db.tables.cbt_bank_question_options = [{ id: 'o', question_id: 'q' }];
    await new QuestionsService(db, { assertBankAccess: async () => 'school' }, {}).remove({ id: 'teacher' }, 'q', 'bank');
    assert.equal(db.tables.cbt_bank_questions.length, 1);
    assert.equal(db.tables.cbt_bank_question_options.length, 1);
});

test('old regrade cannot change scores or recovery flags after reset', async () => {
    const db = fixture();
    await new GradingService(db, {}, { post: async () => {
        db.tables.cbt_exam_attempts[0] = { ...db.tables.cbt_exam_attempts[0], status: 'in_progress', total_score: null,
            metadata: { recovery_submit_only: true } };
        return response(0);
    } }).regradeAttempt('a');
    assert.equal(db.tables.cbt_exam_attempts[0].total_score, null);
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.recovery_submit_only, true);
    assert.equal(db.tables.cbt_answers[0].score, 1);
});

test('regrade refuses active attempts without calling scoring', async () => {
    const db = fixture(); db.tables.cbt_exam_attempts[0].status = 'in_progress';
    await new GradingService(db, {}, { post: () => assert.fail('active attempt') }).regradeAttempt('a');
    assert.equal(db.writes.length, 0);
});

test('manual essay grade updates quiz base score and survives relative scoring', async () => {
    const db = fixture();
    db.tables.cbt_exam_question_snapshots[0].question_snapshot = { ...q, type: 'essay' };
    Object.assign(db.tables.cbt_exam_attempts[0], { total_score: 0, metadata: { base_score: 0 } });
    Object.assign(db.tables.cbt_answers[0], { score: 0, is_correct: null });
    const grading = new GradingService(db, {}, { post: async (_, body) => {
        assert.equal(body.attempts[0].base_score, 100); return { scores: { a: 100 } };
    } });
    await new TeachersService(db, staff, {}, grading).submitEssayGrades({ id: 'teacher' }, 'a', { ans: 1 });
    await grading.applyRelativeQuizScoring('exam');
    assert.equal(db.tables.cbt_exam_attempts[0].total_score, 100);
    assert.equal(db.tables.cbt_exam_attempts[0].metadata.base_score, 100);
});

test('resume fails retryably when saved answers cannot be read', async () => {
    const db = fixture(['cbt_answers']); db.tables.cbt_exam_attempts[0].status = 'in_progress';
    await assert.rejects(new ExamAttemptsService(db, {}, {}).resume(db.tables.cbt_exam_attempts[0], db.tables.cbt_exams[0],
        new Date('2026-09-20T00:30:00Z'), 'device-original'), error => error.getStatus() === 503);
    assert.equal(db.tables.cbt_answers.length, 1);
});

test('question delivery and polling reject missing or different devices', async () => {
    const db = fixture(); db.tables.cbt_exam_attempts[0].status = 'in_progress';
    const service = new ExamAttemptsService(db, {}, {});
    for (const device of [undefined, 'device-second']) {
        await assert.rejects(service.getQuestions({ id: 'student' }, 'exam', device));
        await assert.rejects(service.checkQuestionUpdates({ id: 'student' }, 'exam', {}, device));
    }
    assert.equal((await service.getQuestions({ id: 'student' }, 'exam', 'device-original')).questions.length, 1);
});

test('manual grading rechecks generation under lock after a reset', async () => {
    const db = fixture(); db.tables.cbt_exam_question_snapshots[0].question_snapshot = { ...q, type: 'essay' };
    const transaction = db.transaction.bind(db);
    db.transaction = async work => {
        db.tables.cbt_exam_attempts[0] = { ...db.tables.cbt_exam_attempts[0], status: 'in_progress', total_score: null };
        return transaction(work);
    };
    await assert.rejects(new TeachersService(db, staff, {}, noRelative).submitEssayGrades({ id: 'teacher' }, 'a', { ans: 1 }), /sudah berubah/);
    assert.equal(db.tables.cbt_exam_attempts[0].total_score, null);
});

test('auto grading creates an unanswered essay row that the teacher can grade', async () => {
    const db = fixture(); db.tables.cbt_exam_question_snapshots[0].question_snapshot = { ...q, type: 'essay' };
    db.tables.cbt_exam_attempts[0].total_score = null;
    db.tables.cbt_answers = [];
    const result = await new GradingService(db, {}, { post: async () => ({ ...response(0), items: [] }) }).gradeAttemptFromSavedAnswers('a');
    assert.equal(result.hasEssay, true);
    const teacher = new TeachersService(db, staff, {}, noRelative);
    const details = await teacher.gradingDetails({ id: 'teacher' }, 'a');
    assert.equal(details.essayAnswers.length, 1);
    await teacher.submitEssayGrades({ id: 'teacher' }, 'a', { [details.essayAnswers[0].id]: 0 });
    assert.equal(db.tables.cbt_exam_attempts[0].needs_manual_grading, false);
});

test('failed detail or total writes roll back the entire grade', async () => {
    for (const table of ['cbt_answers', 'cbt_exam_attempts']) {
        const seed = fixture();
        const db = fixtureDb(seed.tables, [], { failMutation: { table, mutation: 'update' } });
        const before = structuredClone(db.tables);
        await assert.rejects(new GradingService(db, {}, { post: async () => response(0) }).regradeAttempt('a'));
        assert.deepEqual(db.tables, before);
    }
});

test('concurrent manual grade is read again before regrade commits', async () => {
    const db = fixture();
    db.tables.cbt_exam_question_snapshots.push({ exam_id: 'exam', question_snapshot: { id: 'essay', type: 'essay', score_default: 1 } });
    db.tables.cbt_answers.push({ id: 'essay-answer', attempt_id: 'a', question_id: 'essay', score: 0, is_correct: null });
    await new GradingService(db, {}, { post: async () => {
        Object.assign(db.tables.cbt_answers[1], { score: 1, is_correct: true });
        return { ...response(1), max_possible_score: 2 };
    } }).regradeAttempt('a');
    assert.equal(db.tables.cbt_exam_attempts[0].total_score, 100);
    assert.equal(db.tables.cbt_answers[1].score, 1);
});

test('relative scoring rejects a stale cohort after a manual grade', async () => {
    const db = fixture();
    const result = await new GradingService(db, {}, { post: async () => {
        db.tables.cbt_exam_attempts[0].metadata.base_score = 70;
        db.tables.cbt_exam_attempts[0].total_score = 70;
        return { scores: { a: 99.99 } };
    } }).applyRelativeQuizScoring('exam');
    assert.deepEqual(result, {});
    assert.equal(db.tables.cbt_exam_attempts[0].total_score, 70);
});

test('pending retry commits detail and total without monitoring', async () => {
    const db = fixture(); db.tables.cbt_exams[0].exam_type = 'exam'; db.tables.cbt_exam_attempts[0].total_score = null;
    const grading = new GradingService(db, {}, { post: async () => response(1) });
    const raw = db.raw;
    db.raw = async (sql, ...params) => sql.includes('ORDER BY finished_at, id')
        ? [structuredClone(db.tables.cbt_exam_attempts[0])] : sql.includes('SELECT DISTINCT') ? [] : raw(sql, ...params);
    await new GradingRetryWorker(db, grading).run();
    assert.equal(db.tables.cbt_exam_attempts[0].total_score, 100);
    assert.equal(db.tables.cbt_answers[0].score, 1);
});

test('retry worker shares an in-flight pass and stops scheduling work after shutdown', async () => {
    let release, count = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const worker = new GradingRetryWorker({ raw: async () => [] }, { retryPendingAutoSubmissions: async () => { count++; await gate; } });
    const first = worker.run(); await worker.run();
    assert.equal(count, 1);
    worker.onModuleDestroy(); release(); await first; await worker.run();
    assert.equal(count, 1);
});

test('retry failure cannot overwrite a reset recovery context', async () => {
    const db = fixture(); db.tables.cbt_exam_attempts[0].total_score = null;
    const grading = new GradingService(db, {}, { post: async () => {
        db.tables.cbt_exam_attempts[0] = { ...db.tables.cbt_exam_attempts[0], status: 'in_progress', metadata: { recovery_submit_only: true } };
        throw Error('offline');
    } });
    await grading.retryPendingAutoSubmissions('exam');
    assert.deepEqual(db.tables.cbt_exam_attempts[0].metadata, { recovery_submit_only: true });
});

test('browser question request forwards its device header', async () => {
    const original = { fetch: global.fetch, window: global.window, localStorage: global.localStorage };
    global.window = {};
    global.localStorage = { getItem: () => 'device-original', setItem: () => {} };
    global.fetch = async (_path, init) => {
        assert.equal(init.headers['x-exam-device'], 'device-original');
        return { ok: true, text: async () => JSON.stringify({ success: true, questions: [] }) };
    };
    try {
        const { getExamQuestionsAction } = require('../../web/lib/api/students.ts');
        assert.equal((await getExamQuestionsAction('exam')).success, true);
    } finally { Object.assign(global, original); }
});

test('delayed original submit preserves a background grade and subsequent manual essay grade', async () => {
    const db = fixture();
    Object.assign(db.tables.cbt_exam_attempts[0], { status: 'in_progress', total_score: null });
    db.tables.cbt_exam_question_snapshots[0].question_snapshot = { ...q, type: 'essay' };
    const service = new ExamAttemptsService(db, { post: async () => {
        // Model a worker commit followed by teacher grading while the first request waits.
        db.tables.cbt_exam_attempts[0].total_score = 80;
        Object.assign(db.tables.cbt_answers[0], { score: 0.8, is_correct: true });
        return { items: [], scaled_score: 0, needs_manual_grading: true, dimension_scores: {} };
    } }, { applyRelativeQuizScoring: async () => ({}) });
    await service.submit({ id: 'student' }, 'exam', { q: 'Essay text' }, undefined, 'a', 'device-original', { q: 1 });
    assert.equal(db.tables.cbt_answers[0].score, 0.8);
    assert.equal(db.tables.cbt_exam_attempts[0].total_score, 80);
});

test('retry keeps backoff metadata and does not score again before it is due', async () => {
    const db = fixture(); db.tables.cbt_exam_attempts[0].total_score = null;
    let requests = 0;
    const grading = new GradingService(db, {}, { post: async () => { requests++; throw Error('offline'); } });
    assert.equal((await grading.retryPendingAutoSubmissions('exam')).failed, 1);
    assert.ok(Date.parse(db.tables.cbt_exam_attempts[0].metadata.grading_retry_next_at) > Date.now());
    await grading.retryPendingAutoSubmissions('exam');
    assert.equal(requests, 1);
});
