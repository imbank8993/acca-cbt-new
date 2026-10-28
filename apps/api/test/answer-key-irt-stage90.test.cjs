const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { assertAnswerKeysReleased } = require('../src/common/answer-key-release.ts');

const denied = error => error.getStatus?.() === 403;
function fixture({ scoring = 'classical,irt_1pl', scores = [70, 80], metadata = {} } = {}) {
    const exam = { id: 'exam', show_results: true, end_time: '2026-09-20T00:00:00Z', scoring_type: scoring,
        metadata: { show_answer_keys: true, ...metadata } };
    const db = fixtureDb({
        cbt_exams: [exam],
        cbt_exam_attempts: scores.map((score_irt, index) => ({ id: `a${index}`, exam_id: 'exam', status: 'submitted', score_irt, metadata: { irt_score_scale: 'theta' } })),
    }, [], { now: '2026-09-21T00:00:00Z' });
    return { db, exam };
}

test('IRT exam keeps answer keys closed until IRT is calculated for every finished attempt', async () => {
    const { db, exam } = fixture({ scores: [null, null] });
    await assert.rejects(assertAnswerKeysReleased(db, exam), error => denied(error) && /IRT/.test(error.message));
    db.tables.cbt_exam_attempts.forEach((attempt, index) => { attempt.score_irt = 60 + index; });
    await assertAnswerKeysReleased(db, exam);
});

test('one participant submitted after the last IRT run keeps keys closed for everyone', async () => {
    const { db, exam } = fixture({ scores: [72, null] });
    await assert.rejects(assertAnswerKeysReleased(db, exam), denied);
});

test('the scoring type is read from the database even when the caller passed a partial exam', async () => {
    const { db } = fixture({ scores: [null] });
    const partial = { id: 'exam', show_results: true, end_time: '2026-09-20T00:00:00Z', metadata: { show_answer_keys: true } };
    await assert.rejects(assertAnswerKeysReleased(db, partial), denied);
});

test('classical exams are unaffected by IRT state', async () => {
    const { db, exam } = fixture({ scoring: 'classical', scores: [null] });
    await assertAnswerKeysReleased(db, exam);
});

test('a key correction in progress closes answer keys for any scoring type', async () => {
    const { db, exam } = fixture({ scoring: 'classical', scores: [null], metadata: { key_correction: { state: 'pending' } } });
    await assert.rejects(assertAnswerKeysReleased(db, exam), error => denied(error) && /koreksi kunci/.test(error.message));
    db.tables.cbt_exams[0].metadata.key_correction.state = 'ready';
    await assertAnswerKeysReleased(db, exam);
});
