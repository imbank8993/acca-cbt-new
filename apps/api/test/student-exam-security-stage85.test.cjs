const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const user = { id: 'student' }, device = 'test-device';
function fixture() {
    const db = fixtureDb({
        cbt_exams: [{ id: 'exam', organization_id: 'school', is_published: true, show_results: false,
            metadata: { is_public: true }, end_time: '2026-09-20T01:00:00Z' }],
        cbt_organization_members: [{ user_id: user.id, organization_id: 'school', is_active: true }],
        cbt_exam_attempts: [{ id: 'attempt', user_id: user.id, exam_id: 'exam', status: 'in_progress',
            started_at: '2026-09-20T00:00:00Z', personal_end_time: '2026-09-20T01:00:00Z', device_fingerprint: device, metadata: {} }],
        cbt_exam_question_snapshots: [{ exam_id: 'exam', question_snapshot: { id: 'q', type: 'essay', bank_question_options: [] } }],
        cbt_answers: [],
    }, [], { now: '2026-09-20T00:30:00Z' });
    const service = new ExamAttemptsService(db, { post: async () => ({ items: [], scaled_score: 87, needs_manual_grading: true }) }, {});
    return { db, service };
}
for (const state of ['missing', 'other-user', 'submitted', 'expired', 'recovery', 'invalid-time']) {
    test(`questions and update polling deny ${state} session`, async () => {
        const { db, service } = fixture();
        const attempt = db.tables.cbt_exam_attempts[0];
        if (state === 'missing') db.tables.cbt_exam_attempts = [];
        if (state === 'other-user') attempt.user_id = 'other';
        if (state === 'submitted') attempt.status = 'submitted';
        if (state === 'expired') attempt.personal_end_time = '2026-09-20T00:30:00Z';
        if (state === 'invalid-time') attempt.personal_end_time = 'invalid';
        if (state === 'recovery') attempt.metadata.recovery_submit_only = true;
        await assert.rejects(service.getQuestions(user, 'exam'), e => e.getStatus() === 403);
        await assert.rejects(service.checkQuestionUpdates(user, 'exam', {}), e => e.getStatus() === 403);
        assert.equal(db.queries.some(q => q.table === 'cbt_exam_question_snapshots'), false);
    });
}
test('active session receives questions', async () => {
    const { service } = fixture();
    assert.equal((await service.getQuestions(user, 'exam')).questions[0].id, 'q');
});
for (const visible of [false, true]) {
    test(`fresh and repeated submissions respect show_results=${visible}`, async () => {
        const { db, service } = fixture();
        db.tables.cbt_exams[0].show_results = visible;
        const attempt = db.tables.cbt_exam_attempts[0];
        const result = await service.submit(user, 'exam', { q: 'timely' }, undefined, 'attempt', device, { q: 1 },
            { startedAt: attempt.started_at, personalEndTime: attempt.personal_end_time });
        assert.equal(result.score, visible ? 87 : null);
        assert.equal(db.tables.cbt_exam_attempts[0].total_score, 87);
        for (const id of ['attempt', undefined]) {
            const retry = await service.submit(user, 'exam', {}, undefined, id, device);
            assert.equal(retry.score, visible ? 87 : null);
        }
    });
}
test('frozen payload respects earlier global deadline', async () => {
    const { db, service } = fixture();
    db.tables.cbt_exams[0].end_time = '2026-09-20T00:20:00Z';
    const attempt = db.tables.cbt_exam_attempts[0];
    await assert.rejects(service.submit(user, 'exam', { q: 'late edit' }, undefined, 'attempt', device, { q: 1 },
        { startedAt: attempt.started_at, personalEndTime: attempt.personal_end_time }), e => e.getStatus() === 403);
    assert.equal(db.tables.cbt_answers.length, 0);
});
