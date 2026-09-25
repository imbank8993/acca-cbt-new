// Run from repository root: node --test apps/api/test/security-stage1.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { loadExamAudience, canAccessExam } = require('../src/students/exam-access.ts');
const { studentQuestion } = require('../src/students/student-question.ts');
const { StudentsService } = require('../src/students/students.service.ts');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const { ExamReviewService } = require('../src/analytics/exam-review.service.ts');
const { StudentAnalyticsService } = require('../src/analytics/student-analytics.service.ts');

const user = { id: 'student', isPlatformAdmin: false };
const exam = { id: 'exam', organization_id: 'school', is_published: true,
    question_bank_id: 'bank', metadata: {} };
// In-memory fixture DB honors row predicates. No connection, credentials or network.
function database(extra = {}, errors = []) {
    const tables = {
        cbt_organization_members: [{ user_id: user.id, organization_id: 'school', is_active: true }],
        cbt_class_members: [], cbt_additional_class_members: [], cbt_exam_participants: [],
        cbt_exam_targets: [], cbt_exams: [exam], cbt_bank_questions: [], cbt_exam_attempts: [],
        cbt_profiles: [], ...extra,
    };
    const queries = [];
    return { queries, raw: async () => [{ now: new Date('2026-09-19T00:00:00Z') }], from(table) {
        const record = { table, calls: [] }; queries.push(record);
        let rows = [...(tables[table] || [])], single = false;
        const builder = new Proxy({}, { get(_, method) {
            if (method === 'then') return (resolve, reject) => Promise.resolve({
                data: errors.includes(table) ? null : single ? rows[0] || null : rows,
                error: errors.includes(table) ? { message: 'synthetic read failure' } : null,
            }).then(resolve, reject);
            return (...args) => {
                record.calls.push([method, ...args]);
                if (method === 'eq') rows = rows.filter(row => row[args[0]] === args[1]);
                if (method === 'in') rows = rows.filter(row => args[1].includes(row[args[0]]));
                if (method === 'limit') rows = rows.slice(0, args[0]);
                if (method === 'maybeSingle') single = true;
                if (method === 'or' && table === 'cbt_exam_targets') {
                    const clauses = [...args[0].matchAll(/(class_id|additional_class_id)\.in\.\(([^)]*)\)/g)];
                    rows = rows.filter(row => clauses.some(m => m[2].split(',').includes(row[m[1]])));
                }
                if (['update', 'insert', 'upsert', 'delete'].includes(method)) {
                    throw new Error('Unexpected write during access/read test');
                }
                return builder;
            };
        }});
        return builder;
    }};
}
const attempts = db => new ExamAttemptsService(db, { post: () => { throw Error('Scoring must not run'); } }, {});
const forbidden = error => error.getStatus?.() === 403;

for (const [name, fixtures] of [
    ['individual participant', { cbt_exam_participants: [{ user_id: user.id, exam_id: exam.id }] }],
    ['regular class', { cbt_class_members: [{ user_id: user.id, class_id: 'class' }],
        cbt_exam_targets: [{ exam_id: exam.id, class_id: 'class' }] }],
    ['additional class', { cbt_additional_class_members: [{ user_id: user.id, class_id: 'extra' }],
        cbt_exam_targets: [{ exam_id: exam.id, additional_class_id: 'extra' }] }],
]) test(`SEC-01: accepts ${name} in active school`, async () => {
    const db = database(fixtures);
    assert.equal(canAccessExam(exam, await loadExamAudience(db, user)), true);
    assert.equal((await new StudentsService(db).getExamForAttempt(user, exam.id)).exam.id, exam.id);
    assert.deepEqual((await attempts(db).getQuestions(user, exam.id)).questions, []);
});

for (const [name, fixtureExam, members] of [
    ['unassigned private exam', exam, undefined],
    ['draft public exam', { ...exam, is_published: false, metadata: { is_public: true } }, undefined],
    ['public exam in another school', { ...exam, organization_id: 'other', metadata: { is_public: true } }, undefined],
    ['inactive membership', { ...exam, metadata: { is_public: true } }, [{ user_id: user.id, organization_id: 'school', is_active: false }]],
]) test(`SEC-01: denies ${name} at detail/questions/start`, async () => {
    const db = database({ cbt_exams: [fixtureExam], ...(members ? { cbt_organization_members: members } : {}) });
    await assert.rejects(new StudentsService(db).getExamForAttempt(user, exam.id), forbidden);
    await assert.rejects(attempts(db).getQuestions(user, exam.id), forbidden);
    await assert.rejects(attempts(db).start(user, exam.id), forbidden);
    assert.equal(db.queries.some(q => q.table === 'cbt_bank_questions'), false);
});

test('SEC-01: membership/target lookup errors fail closed', async () => {
    await assert.rejects(loadExamAudience(database({}, ['cbt_organization_members']), user), e => e.getStatus() === 503);
    await assert.rejects(loadExamAudience(database({ cbt_class_members: [{ user_id: user.id, class_id: 'class' }] }, ['cbt_exam_targets']), user), e => e.getStatus() === 503);
});

test('BUG-13: public school exam appears without assignments; foreign/private/draft excluded', async () => {
    const publicExam = { ...exam, metadata: { is_public: true } };
    const db = database({ cbt_exams: [publicExam, { ...exam, id: 'private' },
        { ...publicExam, id: 'foreign', organization_id: 'other' },
        { ...publicExam, id: 'draft', is_published: false }] });
    const list = await new StudentsService(db).listExams(user);
    assert.deepEqual(list.map(e => e.id), ['exam']);
    assert.equal((await new StudentsService(db).getExamForAttempt(user, 'exam')).exam.id, 'exam');
});

test('SEC-01: questions remain unavailable before start time', async () => {
    const db = database({ cbt_exams: [{ ...exam, start_time: '2099-01-01T00:00:00Z', metadata: { is_public: true } }] });
    await assert.rejects(attempts(db).getQuestions(user, exam.id), forbidden);
    assert.equal(db.queries.some(q => q.table === 'cbt_bank_questions'), false);
});

const question = { id: 'q', type: 'short_answer', question_text: 'Fill ....', score_default: 10,
    metadata: { blanks: [{ answer: 'SECRET', variations: ['SECRET2'] }], correct_order: ['secret-id'],
        instructions: 'Read carefully', explanation: 'SECRET3', allow_file_upload: true, unknown_future_key: 'SECRET4' },
    bank_question_options: [{ id: 'a', option_text: 'Choice A', is_correct: true, weight: 9, order: 8,
        metadata: { explanation: 'SECRET5', dimension_id: 'secret-dimension', image_url: 'image.png' } }],
    stimulus: { id: 's', content: 'Visible passage', private_field: 'SECRET6' },
    instruction: { id: 'i', content: 'Visible instruction', private_field: 'SECRET7' } };

for (const type of ['mcq', 'mcq_complex', 'true_false', 'essay', 'esay', 'uraian', 'short_answer',
    'sjt', 'likert', 'forced_choice', 'paired_comparison', 'ranking', 'checklist', 'ordering']) {
    test(`SEC-02: ${type} DTO preserves rendering and removes grading fields`, () => {
        const result = studentQuestion({ ...question, type }, 'student:exam');
        assert.equal(JSON.stringify(result).includes('SECRET'), false);
        assert.equal(result.bank_question_options[0].is_correct, undefined);
        assert.equal(result.bank_question_options[0].weight, undefined);
        assert.equal(result.metadata.instructions, 'Read carefully');
        assert.equal(result.metadata.allow_file_upload, true);
        assert.equal(result.stimulus.content, 'Visible passage');
        assert.equal(result.instruction.content, 'Visible instruction');
        assert.equal(result.bank_question_options[0].option_text, 'Choice A');
        assert.equal(result.bank_question_options[0].metadata.image_url, 'image.png');
    });
}

for (const [type, multi, single, list] of [
    ['matching', 'match_texts', 'match_text', 'right_items'],
    ['categorization', 'category_names', 'category_name', 'categories'],
]) test(`SEC-02: ${type} keeps unpaired candidates including legacy singular mapping`, () => {
    const options = [{ id: 'a', option_text: 'A', metadata: { [multi]: ['Z', 'Y'] } },
        { id: 'b', option_text: 'B', metadata: { [single]: 'X' } }];
    const result = studentQuestion({ ...question, type, metadata: {}, bank_question_options: options }, 'seed');
    assert.deepEqual(result.metadata[list], ['X', 'Y', 'Z']);
    assert.deepEqual(result.bank_question_options.map(o => o.metadata), [{}, {}]);
    const supplied = studentQuestion({ ...question, type, metadata: { [list]: ['decoy', 'Z'] }, bank_question_options: options }, 'seed');
    assert.deepEqual(supplied.metadata[list], ['Z', 'decoy']);
});

test('SEC-02: ordering presentation is stable and independent of stored correct order', () => {
    const options = ['a', 'b', 'c', 'd'].map((id, order) => ({ id, option_text: id, order }));
    const a = studentQuestion({ ...question, type: 'ordering', bank_question_options: options }, 'seed');
    const b = studentQuestion({ ...question, type: 'ordering', bank_question_options: [...options].reverse().map((o, order) => ({ ...o, order })) }, 'seed');
    assert.deepEqual(a.bank_question_options, b.bank_question_options);
    assert.deepEqual(a.bank_question_options.map(o => o.order), [0, 1, 2, 3]);
    assert.equal(a.metadata.correct_order, undefined);
});

test('SEC-02: actual questions endpoint uses sanitized DTO', async () => {
    const db = database({ cbt_exams: [{ ...exam, metadata: { is_public: true } }],
        cbt_bank_questions: [{ ...question, bank_id: 'bank' }] });
    const result = await attempts(db).getQuestions(user, exam.id);
    assert.equal(result.questions.length, 1);
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
});

for (const status of ['in_progress', 'submitted', 'auto_submitted']) {
    test(`SEC-04: mismatched exam rejected before scoring for ${status}`, async () => {
        const db = database({ cbt_exam_attempts: [{ id: 'attempt', user_id: user.id, exam_id: 'different', status }] });
        await assert.rejects(attempts(db).submit(user, 'exam', {}, undefined, 'attempt', 'device-123'), forbidden);
        await assert.rejects(attempts(db).resolveAttemptForSubmit(user, 'exam', 'attempt'), forbidden);
    });
}
test('SEC-04: matching completed submission stays idempotent', async () => {
    const db = database({ cbt_exam_attempts: [{ id: 'attempt', user_id: user.id, exam_id: 'exam', status: 'submitted', total_score: 80 }] });
    assert.deepEqual(await attempts(db).submit(user, 'exam', {}, undefined, 'attempt', 'device-123'), { score: 80, alreadySubmitted: true, savedAnswersOnly: false });
});

test('SEC-14 / UX-04: results exclude active attempts and redact unreleased scores', async () => {
    const db = database({ cbt_exam_attempts: [
        { id: 'active', user_id: user.id, status: 'in_progress', total_score: 7, exams: { show_results: true } },
        { id: 'hidden', user_id: user.id, status: 'submitted', total_score: 99, score_irt: 98, exams: { show_results: false } },
        { id: 'released', user_id: user.id, status: 'auto_submitted', total_score: 80, exams: { show_results: true } },
    ] });
    const results = await new StudentsService(db).listResults(user);
    assert.deepEqual(results.map(r => r.id), ['hidden', 'released']);
    assert.equal(results[0].total_score, null);
    assert.equal(results[0].score_irt, null);
    assert.equal(results[1].total_score, 80);
});

test('SEC-14: active owner cannot read details or review even if show_results true', async () => {
    const db = database({ cbt_exam_attempts: [{ id: 'attempt', user_id: user.id, status: 'in_progress', exams: { show_results: true } }] });
    await assert.rejects(new StudentsService(db).getAttemptDetails(user, 'attempt'), forbidden);
    await assert.rejects(new ExamReviewService(db, {}).getReview(user, 'attempt'), forbidden);
    assert.equal(db.queries.some(q => ['cbt_answers', 'cbt_bank_questions'].includes(q.table)), false);
});

test('SEC-14: hidden results excluded from history, overview and comparison', async () => {
    const hidden = { id: 'hidden', user_id: user.id, organization_id: 'school', status: 'submitted', total_score: 99, exams: { show_results: false } };
    const db = database({ cbt_exam_attempts: [hidden] });
    const service = new StudentAnalyticsService(db);
    assert.deepEqual(await service.history(user), []);
    assert.equal(await service.overview(user), null);
    assert.deepEqual(await service.comparison(user), { studentAverage: 0, classAverage: 0, difference: 0, betterThanClass: 0 });
});

test('SEC-14: history applies limit after release filtering', async () => {
    const db = database({ cbt_exam_attempts: [
        { user_id: user.id, status: 'submitted', exams: { show_results: false } },
        { id: 'visible', user_id: user.id, status: 'submitted', total_score: 80, exams: { show_results: true } },
    ] });
    const rows = await new StudentAnalyticsService(db).history(user, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'visible');
    assert.equal(rows[0].score, 80);
});
