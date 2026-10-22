const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { QuestionsService } = require('../src/questions/questions.service.ts');
const { syncLiveExamQuestion } = require('../src/common/live-exam-question-updates.ts');
const { GradingService } = require('../src/grading/grading.service.ts');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');
const { StudentsService } = require('../src/students/students.service.ts');
const { mergeExamQuestionUpdates } = require('../../web/lib/exam-question-updates.ts');
const teacher = { id: 'teacher' }, student = { id: 'student' };
const auth = { assertBankAccess: async () => 'school' };
function fixture(options = {}) {
    const opts = [
        { id: 'a', question_id: 'q', option_text: '10', is_correct: true, weight: 1, order: 0, metadata: {} },
        { id: 'b', question_id: 'q', option_text: '20', is_correct: false, weight: 1, order: 1, metadata: {} },
    ];
    const question = { id: 'q', bank_id: 'bank', type: 'mcq', question_text: 'Pilih 10', score_default: 1,
        revision: 1, metadata: { order_index: 0, group_key: 'A' }, stimulus: null, bank_question_options: opts };
    const exam = { id: 'live', question_bank_id: 'bank', organization_id: 'school', status: 'active',
        exam_type: 'exam', scoring_type: 'classical', is_published: true, show_results: true,
        end_time: '2026-09-20T01:00:00Z', metadata: { is_public: true, unrelated: 'retained' } };
    const exams = [exam,
        { ...exam, id: 'ended', end_time: '2026-09-20T00:30:00Z' },
        { ...exam, id: 'archived', status: 'archived' },
        { ...exam, id: 'completed', status: 'completed' },
        { ...exam, id: 'foreign', organization_id: 'other' },
    ];
    const attempt = { id: 'working', exam_id: 'live', user_id: 'student', status: 'in_progress',
        started_at: '2026-09-20T00:00:00Z', personal_end_time: exam.end_time, device_fingerprint: 'test-device', metadata: {} };
    const db = fixtureDb({
        cbt_question_banks: [{ id: 'bank', organization_id: 'school' }],
        cbt_bank_questions: [question], cbt_bank_question_options: opts, cbt_exams: exams,
        cbt_exam_question_snapshots: exams.map(exam => ({ exam_id: exam.id, question_id: 'q', order_number: 1,
            question_snapshot: structuredClone(question) })),
        cbt_exam_attempts: [attempt, ...['done', 'skipped', 'historical'].map(id => ({
            ...attempt, id, user_id: id, exam_id: id === 'historical' ? 'ended' : 'live', status: 'submitted',
            finished_at: '2026-09-20T00:10:00Z', total_score: 100, score_irt: 90, detailed_scores: { irt_1pl: 90 },
        }))],
        cbt_answers: ['working', 'done', 'historical'].map(id => ({ id: `answer-${id}`, attempt_id: id,
            question_id: 'q', selected_option_id: 'a', essay_answer: null, score: 1, is_correct: true, metadata: {} })),
        cbt_organization_members: [{ user_id: 'student', organization_id: 'school', is_active: true }],
    }, [], { now: '2026-09-20T00:30:00Z', ...options });
    return { db, service: new QuestionsService(db, auth, {}),
        dto: { id: 'q', bankId: 'bank', expectedRevision: 1, type: 'mcq', questionText: 'Pilih 100',
            difficulty: 'medium', scoreDefault: 1, metadata: { order_index: 99, group_key: 'Changed' },
            options: opts.map(o => ({ id: o.id, text: o.id === 'a' ? '100' : o.option_text,
                isCorrect: o.is_correct, order: o.order, weight: o.weight, metadata: {} })) } };
}
const snapshot = (db, examId = 'live') => db.tables.cbt_exam_question_snapshots.find(s => s.exam_id === examId).question_snapshot;

test('saving a typo updates live student text, preserves numbering and answers, and leaves archives untouched', async () => {
    const { db, service, dto } = fixture();
    const answers = structuredClone(db.tables.cbt_answers);
    const historical = structuredClone(db.tables.cbt_exam_question_snapshots.filter(s => s.exam_id !== 'live'));
    const saved = await service.save(teacher, dto);
    assert.equal(saved.updatedExams, 1);
    assert.equal(snapshot(db).question_text, 'Pilih 100');
    assert.equal(snapshot(db).bank_question_options[0].option_text, '100');
    assert.equal(snapshot(db).metadata.order_index, 0);
    assert.equal(snapshot(db).metadata.group_key, 'A');
    assert.deepEqual(db.tables.cbt_answers, answers);
    assert.deepEqual(db.tables.cbt_exam_question_snapshots.filter(s => s.exam_id !== 'live'), historical);
    assert.equal(db.tables.cbt_exam_attempts.find(a => a.id === 'done').total_score, 100);
    const studentService = new ExamAttemptsService(db, {}, {});
    const updates = await studentService.checkQuestionUpdates(student, 'live', { q: 1 }, 'test-device');
    assert.equal(updates.hasUpdates, true);
    assert.equal(updates.questions[0].bank_question_options[0].option_text, '100');
    assert.equal(updates.questions[0].revision, 2);
    assert.equal('is_correct' in updates.questions[0].bank_question_options[0], false);
    assert.equal('live_question_update_history' in updates.questions[0].metadata, false);
    assert.equal((await studentService.checkQuestionUpdates(student, 'live', { q: 2 }, 'test-device')).hasUpdates, false);
    const history = db.tables.cbt_exams[0].metadata.live_question_update_history;
    assert.equal(history[0].actorId, 'teacher');
    assert.equal(history[0].previous.question_text, 'Pilih 10');
    assert.equal(history[0].scoringChanged, false);
    const students = new StudentsService(db);
    const detail = await students.getExamForAttempt(student, 'live');
    assert.equal(detail.exam.metadata.is_public, true);
    assert.equal('live_question_update_history' in detail.exam.metadata, false);
    const list = await students.listExams(student);
    assert.equal('live_question_update_history' in list[0].metadata, false);
});

test('a changed key queues every finished participant including skipped answers, then recalculates automatically', async () => {
    const { db, service, dto } = fixture();
    dto.options.forEach(option => { option.isCorrect = option.id === 'b'; });
    const answers = structuredClone(db.tables.cbt_answers);
    await service.save(teacher, dto);
    for (const id of ['done', 'skipped']) {
        const attempt = db.tables.cbt_exam_attempts.find(a => a.id === id);
        assert.equal(attempt.total_score, null);
        assert.equal(attempt.score_irt, null);
        assert.equal(attempt.detailed_scores, null);
    }
    assert.equal(db.tables.cbt_exam_attempts.find(a => a.id === 'historical').total_score, 100);
    assert.deepEqual(db.tables.cbt_answers, answers);
    const grading = new GradingService(db, {}, { post: async (_path, payload) => {
        const items = payload.items.map(item => ({ answer_id: item.answer_id,
            score: item.question.bank_question_options.some(o => o.id === item.raw_answer && o.is_correct) ? 1 : 0,
            is_correct: item.question.bank_question_options.some(o => o.id === item.raw_answer && o.is_correct) }));
        return { items, total_score: items.reduce((n, i) => n + i.score, 0), max_possible_score: 1 };
    } });
    const result = await grading.retryPendingAutoSubmissions('live');
    assert.equal(result.recovered, 2);
    assert.equal(db.tables.cbt_exam_attempts.find(a => a.id === 'done').total_score, 0);
    assert.equal(db.tables.cbt_exam_attempts.find(a => a.id === 'skipped').total_score, 0);
    await grading.retryLiveQuestionRegrades();
    assert.equal(db.tables.cbt_exams[0].metadata.live_question_regrade_pending, false);
    assert.equal(db.tables.cbt_answers.find(a => a.attempt_id === 'done').selected_option_id, 'a');
});

test('audit and grade invalidation are atomic with the bank edit', async () => {
    const { db, service, dto } = fixture({ failMutation: { table: 'cbt_exam_attempts', mutation: 'update' } });
    // Pindahkan kunci (soal tanpa kunci benar kini ditolak validasi struktur).
    dto.options[0].isCorrect = false;
    dto.options[1].isCorrect = true;
    const before = structuredClone(db.tables);
    await assert.rejects(service.save(teacher, dto), /Antrean penilaian ulang/);
    assert.deepEqual(db.tables, before);
});

test('question types and option identities cannot change underneath live answers', async () => {
    const { db, service, dto } = fixture();
    dto.type = 'true_false';
    const before = structuredClone(db.tables);
    await assert.rejects(service.save(teacher, dto), /Pertahankan tipe soal/);
    assert.deepEqual(db.tables, before);
    db.tables.cbt_bank_questions[0].bank_question_options.push({ id: 'new', is_correct: false });
    await assert.rejects(db.transaction(tx => syncLiveExamQuestion(tx, 'q', 'school', 'teacher')), /jumlah dan ID opsi/);
});

test('IRT retries finish only after classical grades and survive scorer failure or a newer revision', async () => {
    const { db } = fixture();
    const exam = db.tables.cbt_exams[0];
    exam.scoring_type = 'classical, irt_1pl';
    exam.metadata = { ...exam.metadata, live_question_regrade_pending: true, live_question_revision: 2 };
    const grading = new GradingService(db, {}, {});
    let calls = 0;
    grading.applyRelativeQuizScoringIfQuiz = async () => ({});
    grading.calculateIrtForExam = async () => { calls++; throw Error('scorer offline'); };
    await grading.retryLiveQuestionRegrades();
    assert.equal(exam.metadata.live_question_regrade_pending, true);
    assert.equal(calls, 1);
    db.tables.cbt_exam_attempts.find(a => a.id === 'done').total_score = null;
    await grading.retryLiveQuestionRegrades();
    assert.equal(calls, 1);
    db.tables.cbt_exam_attempts.find(a => a.id === 'done').total_score = 50;
    grading.calculateIrtForExam = async () => { exam.metadata.live_question_revision++; };
    await grading.retryLiveQuestionRegrades();
    assert.equal(exam.metadata.live_question_regrade_pending, true);
    grading.calculateIrtForExam = async () => {};
    await grading.retryLiveQuestionRegrades();
    assert.equal(exam.metadata.live_question_regrade_pending, false);
});

test('out-of-order updates preserve question positions and option IDs without reverting newer text', () => {
    const current = [{ id: 'q', revision: 2, question_text: '10', bank_question_options: [
        { id: 'b', order: 0 }, { id: 'a', order: 1 },
    ] }, { id: 'other', revision: 1 }];
    const next = mergeExamQuestionUpdates(current, [{ id: 'q', revision: 3, question_text: '100', bank_question_options: [
        { id: 'a', order: 0, option_text: '100' }, { id: 'b', order: 1, option_text: '20' },
    ] }]);
    assert.deepEqual(next.map(q => q.id), ['q', 'other']);
    assert.deepEqual(next[0].bank_question_options.map(o => [o.id, o.order]), [['b', 0], ['a', 1]]);
    assert.equal(next[0].question_text, '100');
    assert.equal(mergeExamQuestionUpdates(next, current)[0].question_text, '100');
});

test('a scoring request already in flight cannot overwrite a live key edit', async () => {
    const { db, service: bank, dto } = fixture();
    dto.options.forEach(option => { option.isCorrect = option.id === 'b'; });
    const submitting = new ExamAttemptsService(db, { post: async () => {
        await bank.save(teacher, dto);
        return { items: [{ answer_id: 'q', score: 1, is_correct: true }], scaled_score: 100,
            needs_manual_grading: false, dimension_scores: {} };
    } }, {});
    await submitting.submit(student, 'live', { q: 'a' }, undefined, 'working', 'test-device', { q: 1 });
    const attempt = db.tables.cbt_exam_attempts.find(a => a.id === 'working');
    assert.equal(attempt.status, 'submitted');
    assert.equal(attempt.total_score, null);
    assert.equal(snapshot(db).bank_question_options.find(o => o.id === 'b').is_correct, true);
    assert.equal(db.tables.cbt_answers.find(a => a.attempt_id === 'working').selected_option_id, 'a');
});

test('stale editor revisions never update the bank, live copy or grade queue', async () => {
    const { db, service, dto } = fixture();
    await service.save(teacher, dto);
    const before = structuredClone(db.tables);
    await assert.rejects(service.save(teacher, dto), /tab lain/);
    assert.deepEqual(db.tables, before);
});

for (const status of ['draft', 'scheduled']) {
    test(`an unfinished ${status} exam also receives bank revisions`, async () => {
        const { db, service, dto } = fixture();
        db.tables.cbt_exams[0].status = status;
        assert.equal((await service.save(teacher, dto)).updatedExams, 1);
        assert.equal(snapshot(db).question_text, 'Pilih 100');
    });
}
