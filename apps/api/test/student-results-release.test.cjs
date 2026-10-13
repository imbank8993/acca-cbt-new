const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { StudentsService } = require('../src/students/students.service.ts');
const user = { id: 'student' };
function fixture() {
    return fixtureDb({
        cbt_exam_attempts: [{ id: 'attempt', user_id: user.id, exam_id: 'exam', status: 'submitted',
            total_score: 80, score_irt: 75, needs_manual_grading: false,
            metadata: { submission_payload: { secret: true } },
            exams: { id: 'exam', title: 'Exam', show_results: true, question_bank_id: 'bank',
                end_time: '2026-09-19T00:00:00Z', metadata: {} } }],
        cbt_answers: [{ id: 'answer', attempt_id: 'attempt', question_id: 'q',
            bank_questions: { id: 'q', type: 'mcq', metadata: { answer: 'SECRET' },
                bank_question_options: [{ id: 'correct', is_correct: true }] } }],
    });
}
for (const scenario of ['legacy-unset', 'disabled', 'future-end', 'no-end', 'active-session']) {
    test(`released score survives unavailable discussion: ${scenario}`, async () => {
        const db = fixture(), exam = db.tables.cbt_exam_attempts[0].exams;
        if (scenario !== 'legacy-unset') exam.metadata.show_answer_keys = scenario !== 'disabled';
        if (scenario === 'future-end') exam.end_time = '2026-09-21T00:00:00Z';
        if (scenario === 'no-end') exam.end_time = null;
        if (scenario === 'active-session') db.tables.cbt_exam_attempts.push({ id: 'other', exam_id: 'exam',
            user_id: 'other', status: 'in_progress', started_at: '2026-09-19T00:00:00Z',
            personal_end_time: '2026-09-21T00:00:00Z',
            metadata: { proctor_recovery_until: '2026-09-21T00:00:00Z' } });
        const result = await new StudentsService(db).getAttemptDetails(user, 'attempt');
        assert.equal(result.attempt.total_score, 80);
        assert.equal(result.attempt.score_irt, 75);
        assert.equal(result.answerKeysReleased, false);
        assert.ok(result.answerKeysMessage);
        assert.deepEqual(result.answers, []);
        assert.ok(!JSON.stringify(result).includes('SECRET'));
        assert.equal(result.attempt.metadata.submission_payload, undefined);
        assert.ok(!db.queries.some(q => q.table === 'cbt_answers'));
    });
}
test('released discussion includes answers; provisional scores remain accessible', async () => {
    const db = fixture();
    db.tables.cbt_exam_attempts[0].exams.metadata.show_answer_keys = true;
    db.tables.cbt_exam_attempts[0].needs_manual_grading = true;
    const result = await new StudentsService(db).getAttemptDetails(user, 'attempt');
    assert.equal(result.answerKeysReleased, true);
    assert.equal(result.answers[0].question.options[0].is_correct, true);
    assert.equal(result.attempt.needs_manual_grading, true);
});
test('hidden scores remain masked and unavailable through direct detail requests', async () => {
    const db = fixture(); db.tables.cbt_exam_attempts[0].exams.show_results = false;
    const service = new StudentsService(db);
    assert.equal((await service.listResults(user))[0].total_score, null);
    assert.equal((await service.listResults(user))[0].score_irt, null);
    await assert.rejects(service.getAttemptDetails(user, 'attempt'), e => e.getStatus() === 403);
});
test('ownership and completion gates still protect score summaries', async () => {
    const db = fixture(), service = new StudentsService(db);
    await assert.rejects(service.getAttemptDetails({ id: 'other' }, 'attempt'), e => e.getStatus() === 403);
    db.tables.cbt_exam_attempts[0].status = 'in_progress';
    await assert.rejects(service.getAttemptDetails(user, 'attempt'), e => e.getStatus() === 403);
});
test('database failures cannot masquerade as empty results or missing attempts', async () => {
    const db = fixtureDb({}, ['cbt_exam_attempts']), service = new StudentsService(db);
    await assert.rejects(service.listResults(user), e => e.getStatus() === 500);
    await assert.rejects(service.getAttemptDetails(user, 'attempt'), e => e.getStatus() === 500);
    await assert.rejects(new StudentsService(fixtureDb()).getAttemptDetails(user, 'missing'), e => e.getStatus() === 404);
});
test('discussion lookup failure is reported as a server error, not a release decision', async () => {
    const { assertAnswerKeysReleased } = require('../src/common/answer-key-release.ts');
    const exam = fixture().tables.cbt_exam_attempts[0].exams;
    exam.metadata.show_answer_keys = true;
    await assert.rejects(assertAnswerKeysReleased(fixtureDb({}, ['cbt_exam_attempts']), exam), e => e.getStatus() === 500);
});
