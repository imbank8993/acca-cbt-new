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

test('ANS-04: bulk sync gagal atomik jika satu jawaban tidak sah', async () => {
    const db = fixtureDb(tables());

    await assert.rejects(
        service(db).syncAnswers(user, 'attempt', [
            { questionId: 'q-main', selected_option_id: 'opt-main' },
            { questionId: 'q-foreign', selected_option_id: 'opt-foreign' },
        ], deviceId),
        error => error.getStatus?.() === 400,
    );
    assert.equal(db.tables.cbt_answers.length, 0);
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
