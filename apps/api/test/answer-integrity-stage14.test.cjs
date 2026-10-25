// Run from repository root: node --test apps/api/test/answer-integrity-stage14.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const { fixtureDb } = require('./fixture-db.cjs');
const { ExamAttemptsService } = require('../src/students/exam-attempts.service.ts');

const user = { id: 'student', isPlatformAdmin: false };
const deviceId = 'device-answer-integrity';

function tables() {
    return {
        cbt_exams: [{
            id: 'exam', organization_id: 'school', question_bank_id: 'bank-main',
            start_time: '2026-09-19T23:00:00Z', end_time: '2026-09-20T01:00:00Z',
            duration_minutes: 60, is_published: true,
        }],
        cbt_exam_question_sources: [{ exam_id: 'exam', bank_id: 'bank-extra' }],
        cbt_exam_attempts: [{
            id: 'attempt', user_id: user.id, exam_id: 'exam', status: 'in_progress',
            started_at: '2026-09-19T23:30:00Z', personal_end_time: '2026-09-20T01:00:00Z',
            device_fingerprint: deviceId, metadata: {},
        }],
        cbt_bank_questions: [
            {
                id: 'q-main', bank_id: 'bank-main', type: 'mcq', created_at: '2026-01-01T00:00:00Z',
                bank_question_options: [{ id: 'opt-main' }, { id: 'opt-other' }],
            },
            {
                id: 'q-extra', bank_id: 'bank-extra', type: 'essay', created_at: '2026-01-01T00:00:01Z',
                bank_question_options: [],
            },
            {
                id: 'q-foreign', bank_id: 'bank-foreign', type: 'mcq', created_at: '2026-01-01T00:00:02Z',
                bank_question_options: [{ id: 'opt-foreign' }],
            },
        ],
        cbt_answers: [],
    };
}

function service(db) {
    return new ExamAttemptsService(
        db,
        { post: async () => ({ items: [], scaled_score: 0, needs_manual_grading: false, dimension_scores: {} }) },
        { gradeAttemptFromSavedAnswers: async () => null },
    );
}

test('failed rejection logging cannot acknowledge answers from a rolled-back transaction', async () => {
    const db = fixtureDb(tables(), [], { failMutation: { table: 'cbt_attempt_security_logs', mutation: 'insert' } });
    await assert.rejects(service(db).syncAnswers(user, 'attempt', [
        { questionId: 'q-main', selected_option_id: 'opt-main' },
        { questionId: 'q-foreign', selected_option_id: 'opt-foreign' },
    ], deviceId), error => error.getStatus?.() === 503);
    assert.deepEqual(db.tables.cbt_answers, []);
});

test('ANS-04: autosave menolak soal dari bank yang bukan sumber ujian', async () => {
    const db = fixtureDb(tables());

    await assert.rejects(
        service(db).saveAnswer(
            user,
            'attempt',
            { questionId: 'q-foreign', selected_option_id: 'opt-foreign' },
            deviceId,
        ),
        error => error.getStatus?.() === 400 && /tidak termasuk dalam ujian/i.test(error.message),
    );
    assert.equal(db.tables.cbt_answers.length, 0);
});

test('ANS-04: autosave menolak opsi yang bukan milik soal', async () => {
    const data = tables();
    data.cbt_bank_questions[0].bank_question_options = [{ id: 'opt-main' }];
    const db = fixtureDb(data);

    await assert.rejects(
        service(db).saveAnswer(
            user,
            'attempt',
            { questionId: 'q-main', selected_option_id: 'opt-foreign' },
            deviceId,
        ),
        error => error.getStatus?.() === 400 && /tidak termasuk dalam soal/i.test(error.message),
    );
    assert.equal(db.tables.cbt_answers.length, 0);
});

test('ANS-04: satu jawaban tidak sah tidak menahan jawaban lain dalam bulk sync', async () => {
    // Dulu seluruh kiriman ditolak dan klien mengulang kiriman yang sama sampai
    // waktu habis, sehingga jawaban sah ikut tidak pernah sampai di server.
    const data = tables();
    data.cbt_attempt_security_logs = [];
    const db = fixtureDb(data);

    const result = await service(db).syncAnswers(user, 'attempt', [
        { questionId: 'q-main', selected_option_id: 'opt-main' },
        { questionId: 'q-foreign', selected_option_id: 'opt-foreign' },
        { questionId: 'q-extra', essay_answer: 'Jawaban esai' },
    ], deviceId);

    assert.deepEqual(db.tables.cbt_answers.map(row => row.question_id).sort(), ['q-extra', 'q-main']);
    assert.equal(result.saved, 2);
    assert.deepEqual(result.rejected.map(item => [item.questionId, item.code]), [['q-foreign', 'QUESTION_NOT_IN_EXAM']]);
    const log = db.tables.cbt_attempt_security_logs.find(row => row.event_type === 'ANSWERS_REJECTED');
    assert.equal(log.metadata.count, 1);
    assert.deepEqual(log.metadata.codes, { QUESTION_NOT_IN_EXAM: 1 });
    assert.equal(JSON.stringify(log.metadata).includes('opt-foreign'), false, 'isi jawaban tidak dicatat');
});

test('ANS-04: versi lama dari perangkat dilewati, bukan menggagalkan kiriman', async () => {
    const data = tables();
    data.cbt_attempt_security_logs = [];
    data.cbt_answers = [{ id: 'a1', attempt_id: 'attempt', question_id: 'q-main', selected_option_id: 'opt-other',
        essay_answer: null, is_doubtful: false, metadata: { answer_revision: 5 } }];
    const db = fixtureDb(data);

    const result = await service(db).syncAnswers(user, 'attempt', [
        { questionId: 'q-main', selected_option_id: 'opt-main', revision: 3 },
        { questionId: 'q-extra', essay_answer: 'Baru', revision: 1 },
    ], deviceId);

    assert.deepEqual(result.superseded, ['q-main']);
    assert.deepEqual(result.rejected, []);
    assert.equal(db.tables.cbt_answers.find(row => row.question_id === 'q-main').selected_option_id, 'opt-other');
    assert.equal(db.tables.cbt_answers.find(row => row.question_id === 'q-extra').essay_answer, 'Baru');

    // Autosave satu jawaban tetap tegas: versi lama ditolak dengan 409.
    await assert.rejects(
        service(db).saveAnswer(user, 'attempt', { questionId: 'q-main', selected_option_id: 'opt-main', revision: 4 }, deviceId),
        error => error.getStatus?.() === 409,
    );
});

test('ANS-04: soal direct dan multi-bank menerima format jawaban yang benar', async () => {
    const db = fixtureDb(tables());
    const attempts = service(db);

    await attempts.syncAnswers(user, 'attempt', [
        { questionId: 'q-main', selected_option_id: 'opt-main' },
        { questionId: 'q-extra', essay_answer: 'Jawaban esai' },
    ], deviceId);

    assert.deepEqual(
        db.tables.cbt_answers.map(row => ({
            question_id: row.question_id,
            selected_option_id: row.selected_option_id,
            essay_answer: row.essay_answer,
        })),
        [
            { question_id: 'q-main', selected_option_id: 'opt-main', essay_answer: null },
            { question_id: 'q-extra', selected_option_id: null, essay_answer: 'Jawaban esai' },
        ],
    );
});

test('ANS-04: format kolom yang tidak sesuai tipe soal ditolak', async () => {
    const db = fixtureDb(tables());
    const attempts = service(db);

    await assert.rejects(
        attempts.saveAnswer(user, 'attempt', { questionId: 'q-main', essay_answer: 'bukan opsi' }, deviceId),
        error => error.getStatus?.() === 400 && /format jawaban/i.test(error.message),
    );
    await assert.rejects(
        attempts.saveAnswer(user, 'attempt', { questionId: 'q-extra', selected_option_id: 'opt-main' }, deviceId),
        error => error.getStatus?.() === 400 && /format jawaban/i.test(error.message),
    );
    assert.equal(db.tables.cbt_answers.length, 0);
});
