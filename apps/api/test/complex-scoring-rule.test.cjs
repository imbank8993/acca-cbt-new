const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { loadFrozenExamQuestions, readExamQuestionVersion } = require('../src/common/exam-question-snapshots.ts');
const { examComplexScoringRule } = require('../src/common/complex-scoring.ts');
const { GradingService } = require('../src/grading/grading.service.ts');

const questions = [
    { id: 'tf', bank_id: 'bank', type: 'true_false', score_default: 4, metadata: { order_index: 1 },
        bank_question_options: [{ id: 's1', is_correct: true }, { id: 's2', is_correct: false }, { id: 's3', is_correct: true }] },
    { id: 'cat', bank_id: 'bank', type: 'categorization', score_default: 4,
        bank_question_options: [{ id: 'c1', metadata: { category_names: ['A'] } }] },
    { id: 'pg', bank_id: 'bank', type: 'mcq', score_default: 1,
        bank_question_options: [{ id: 'a', is_correct: true }] },
];

function snapshotDb(metadata) {
    return fixtureDb({
        cbt_exams: [{ id: 'exam', metadata }],
        cbt_exam_question_snapshots: questions.map((question_snapshot, order_number) =>
            ({ exam_id: 'exam', order_number, question_snapshot: structuredClone(question_snapshot) })),
        cbt_exam_attempts: [],
        cbt_answers: [],
    });
}

test('rule defaults to official and only an explicit marker selects the old rule', () => {
    assert.equal(examComplexScoringRule(null), 'official');
    assert.equal(examComplexScoringRule({}), 'official');
    assert.equal(examComplexScoringRule({ complex_scoring_rule: 'official' }), 'official');
    assert.equal(examComplexScoringRule({ complex_scoring_rule: 'proportional' }), 'proportional');
});

test('legacy exams mark frozen B/S and categorization copies, never the stored snapshot', async () => {
    const db = snapshotDb({ complex_scoring_rule: 'proportional' });
    const frozen = await loadFrozenExamQuestions(db, 'exam');
    const byId = Object.fromEntries(frozen.map(question => [question.id, question]));
    assert.equal(byId.tf.metadata.complex_scoring, 'proportional');
    assert.equal(byId.tf.metadata.order_index, 1);
    assert.equal(byId.cat.metadata.complex_scoring, 'proportional');
    assert.equal(byId.pg.metadata?.complex_scoring, undefined);
    assert.equal(db.tables.cbt_exam_question_snapshots[0].question_snapshot.metadata.complex_scoring, undefined);
    // Grading compares both reads before writing scores; they must stay identical.
    assert.deepEqual(await readExamQuestionVersion(db, 'exam'), frozen);
});

test('new exams carry no marker and are graded with the official rule', async () => {
    const frozen = await loadFrozenExamQuestions(snapshotDb({}), 'exam');
    assert.ok(frozen.every(question => question.metadata?.complex_scoring === undefined));
});

test('a freshly frozen exam with the old rule is marked on its first read too', async () => {
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', question_bank_id: 'bank', metadata: { complex_scoring_rule: 'proportional' } }],
        cbt_exam_question_sources: [],
        cbt_bank_questions: [structuredClone(questions[0])],
        cbt_exam_question_snapshots: [],
    });
    const first = await loadFrozenExamQuestions(db, 'exam');
    const second = await loadFrozenExamQuestions(db, 'exam');
    assert.equal(first[0].metadata.complex_scoring, 'proportional');
    assert.deepEqual(first, second);
});

test('the scoring service receives the marker through the normal grading payload', async () => {
    const db = snapshotDb({ complex_scoring_rule: 'proportional' });
    db.tables.cbt_exams[0].exam_type = 'daily';
    db.tables.cbt_exam_attempts.push({ id: 'attempt', exam_id: 'exam', status: 'submitted', total_score: null,
        started_at: '2026-10-30T00:00:00Z', finished_at: '2026-10-30T01:00:00Z', metadata: {} });
    const sent = [];
    const scoring = { post: async (url, body) => {
        sent.push(body);
        return { items: [], total_score: 0, max_possible_score: 9, scaled_score: 0, needs_manual_grading: false, dimension_scores: {} };
    } };
    await new GradingService(db, {}, scoring).gradeAttemptFromSavedAnswers('attempt');
    const tf = sent[0].items.find(item => item.question.id === 'tf');
    assert.equal(tf.question.metadata.complex_scoring, 'proportional');
});

const { normalizePasExamSettings, pasExamSettingsUpdate, resolvePasExamSettings } = require('../src/common/pas-exam-settings.ts');

test('folder settings choose the rule for exams nobody has started yet', () => {
    const config = normalizePasExamSettings({ defaults: { complex_scoring: 'proportional' } });
    const settings = resolvePasExamSettings(config, null);
    const fresh = pasExamSettingsUpdate({ id: 'e', metadata: {} }, settings, false);
    assert.equal(fresh.update.metadata.complex_scoring_rule, 'proportional');
    assert.equal(fresh.scoringRuleLocked, false);
    const back = pasExamSettingsUpdate({ id: 'e', metadata: { complex_scoring_rule: 'proportional' } },
        resolvePasExamSettings(normalizePasExamSettings({}), null), false);
    assert.equal(back.update.metadata.complex_scoring_rule, 'official');
});

test('the rule of a started exam never changes and the lock is reported', () => {
    const settings = resolvePasExamSettings(normalizePasExamSettings({ defaults: { complex_scoring: 'official' } }), null);
    const legacy = pasExamSettingsUpdate({ id: 'e', metadata: { complex_scoring_rule: 'proportional' } }, settings, true);
    assert.equal(legacy.update.metadata.complex_scoring_rule, 'proportional');
    assert.equal(legacy.scoringRuleLocked, true);
    const same = pasExamSettingsUpdate({ id: 'e', metadata: {} }, settings, true);
    assert.equal(same.scoringRuleLocked, false);
});

test('invalid rules are refused', () => {
    assert.throws(() => normalizePasExamSettings({ defaults: { complex_scoring: 'separuh' } }), /resmi atau proporsional/);
});

test('legacy marker also keeps the old IRT guessing parameter for PGK, short answer and ordering', () => {
    const { applyComplexScoringRule } = require('../src/common/complex-scoring.ts');
    for (const type of ['mcq_complex', 'short_answer', 'ordering']) {
        assert.equal(applyComplexScoringRule({ type, metadata: {} }, 'proportional').metadata.complex_scoring, 'proportional');
        assert.deepEqual(applyComplexScoringRule({ type, metadata: {} }, 'official').metadata, {});
    }
    assert.equal(applyComplexScoringRule({ type: 'matching' }, 'proportional').metadata, undefined);
});
