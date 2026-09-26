// Run from repository root: node --test apps/api/test/question-sources-stage10.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { loadExamQuestions, resolveExamBankIds } = require('../src/common/exam-question-sources.ts');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const { GradingService } = require('../src/grading/grading.service.ts');

const user = { id: 'student', isPlatformAdmin: false };

function tables() {
    return {
        cbt_exams: [{
            id: 'exam', organization_id: 'school', question_bank_id: null,
            is_published: true, exam_type: 'daily', start_time: '2026-09-19T00:00:00Z',
            randomize_questions: false, randomize_options: false, metadata: { is_public: true },
        }],
        cbt_exam_question_sources: [
            { id: 'source-b', exam_id: 'exam', bank_id: 'bank-b' },
            { id: 'source-a', exam_id: 'exam', bank_id: 'bank-a' },
            { id: 'source-a-copy', exam_id: 'exam', bank_id: 'bank-a' },
        ],
        cbt_bank_questions: [
            {
                id: 'question-b', bank_id: 'bank-b', question_text: 'B', type: 'mcq',
                score_default: 1, created_at: '2026-01-01T00:00:00Z', metadata: { order_index: 0 },
                bank_question_options: [{ id: 'b1', option_text: 'B1', order: 0, is_correct: true }],
            },
            {
                id: 'question-a', bank_id: 'bank-a', question_text: 'A', type: 'mcq',
                score_default: 1, created_at: '2026-01-02T00:00:00Z', metadata: { order_index: 0 },
                bank_question_options: [{ id: 'a1', option_text: 'A1', order: 0, is_correct: true }],
            },
        ],
        cbt_exam_attempts: [{ id: 'attempt', exam_id: 'exam', user_id: user.id, metadata: {} }],
        cbt_answers: [
            { id: 'answer-a', attempt_id: 'attempt', question_id: 'question-a', selected_option_id: 'a1', score: 1, is_correct: true },
            { id: 'answer-b', attempt_id: 'attempt', question_id: 'question-b', selected_option_id: 'b1', score: 1, is_correct: true },
        ],
        cbt_organization_members: [{ user_id: user.id, organization_id: 'school', is_active: true }],
        cbt_class_members: [], cbt_additional_class_members: [], cbt_exam_participants: [],
    };
}

test('BUG-12: legacy multi-bank questions rendered and graded as the same set', async () => {
    const db = fixtureDb(tables());
    let gradedIds = [];
    const scoring = { post: async (_path, body) => {
        gradedIds = body.items.map(item => item.question.id);
        return {
            items: body.items.map(item => ({ answer_id: item.answer_id, score: 1, is_correct: true })),
            total_score: 2, max_possible_score: 2, needs_manual_grading: false,
            scaled_score: 100, dimension_scores: {},
        };
    } };

    const displayed = await new ExamAttemptsService(db, scoring, {}).getQuestions(user, 'exam');
    const grading = new GradingService(db, {}, scoring);
    const result = await grading.gradeAttemptFromSavedAnswers('attempt');

    const displayedIds = displayed.questions.map(question => question.id);
    assert.deepEqual(displayedIds, ['question-a', 'question-b']);
    assert.deepEqual(gradedIds, displayedIds);
    assert.equal(result.finalScore100, 100);
});

test('BUG-12: direct bank is combined with unique legacy sources in stable order', async () => {
    const state = tables();
    state.cbt_exams[0].question_bank_id = 'bank-direct';
    state.cbt_exam_question_sources.push({ id: 'source-direct', exam_id: 'exam', bank_id: 'bank-direct' });
    state.cbt_bank_questions.push({
        id: 'question-direct', bank_id: 'bank-direct', question_text: 'Direct', type: 'mcq',
        created_at: '2026-01-03T00:00:00Z', metadata: { order_index: 0 }, bank_question_options: [],
    });
    const db = fixtureDb(state);

    assert.deepEqual(await resolveExamBankIds(db, 'exam'), ['bank-direct', 'bank-a', 'bank-b']);
    const questions = await loadExamQuestions(db, 'exam', 'id, metadata, created_at');
    assert.deepEqual(questions.map(question => question.id), ['question-direct', 'question-a', 'question-b']);
    assert.equal(JSON.stringify(questions).includes('__exam_source_order'), false);
});

test('BUG-12: browser always asks backend for exam questions', () => {
    const source = fs.readFileSync(
        path.resolve(__dirname, '../../web/app/components/questions/ExamPage.tsx'),
        'utf8',
    );
    assert.match(source, /const qRes = await getExamQuestionsAction\(examId\)/);
    assert.doesNotMatch(source, /if \(qbId\)/);
});
