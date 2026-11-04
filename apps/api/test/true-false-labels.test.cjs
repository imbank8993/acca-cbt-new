const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const {
    normalizeTrueFalseLabels, trueFalseLabels, parseTrueFalseKey, trueFalseLabelPreset, isRtlLabel,
    trueFalseLabelsForSubject, importedTrueFalseLabels,
} = require('@acca-cbt/shared');
const { studentQuestion } = require('../src/students/student-question.ts');

test('B/S labels: presets, custom text, and invalid input fall back to Benar/Salah', () => {
    assert.deepEqual(trueFalseLabels(null), { true: 'Benar', false: 'Salah' });
    assert.deepEqual(trueFalseLabels({ true_false_labels: { true: 'True', false: 'False' } }), { true: 'True', false: 'False' });
    assert.deepEqual(trueFalseLabels(JSON.stringify({ true_false_labels: { true: 'صحيح', false: 'خطأ' } })), { true: 'صحيح', false: 'خطأ' });
    assert.deepEqual(normalizeTrueFalseLabels({ true: ' <b>Fakta</b> ', false: 'Opini' }), { true: 'Fakta', false: 'Opini' });
    assert.equal(normalizeTrueFalseLabels({ true: 'Ya', false: 'ya' }), null);
    assert.equal(normalizeTrueFalseLabels({ true: 'Ya', false: '' }), null);
    assert.equal(normalizeTrueFalseLabels({ true: 'Benar', false: 'Salah' }), null);
    assert.equal(normalizeTrueFalseLabels({ true: 'x'.repeat(80), false: 'y' }).true.length, 24);
    assert.equal(trueFalseLabelPreset({ true: 'True', false: 'False' }), 'en');
    assert.equal(trueFalseLabelPreset({ true: 'Fakta', false: 'Opini' }), 'custom');
    assert.equal(isRtlLabel('صحيح'), true);
    assert.equal(isRtlLabel('True'), false);
});

test('B/S import keys accept the question labels and the universal codes', () => {
    const labels = { true: 'Fakta', false: 'Opini' };
    assert.equal(parseTrueFalseKey('fakta', labels), true);
    assert.equal(parseTrueFalseKey('Opini', labels), false);
    for (const key of ['B', 'benar', 'T', 'True', 'صحيح']) assert.equal(parseTrueFalseKey(key), true, key);
    for (const key of ['S', 'salah', 'F', 'false', 'خطأ']) assert.equal(parseTrueFalseKey(key), false, key);
    assert.equal(parseTrueFalseKey('Mungkin'), null);
    assert.equal(parseTrueFalseKey(''), null);
});

test('participants receive cleaned B/S labels only for B/S questions', () => {
    const options = [{ id: 'a', option_text: 'One', is_correct: true, metadata: {} }];
    const tf = studentQuestion({ id: 'q1', type: 'true_false', metadata: { true_false_labels: { true: '<i>True</i>', false: 'False' }, pembahasan: 'secret' }, bank_question_options: options }, 'seed');
    assert.deepEqual(tf.metadata, { true_false_labels: { true: 'True', false: 'False' } });
    assert.equal(tf.bank_question_options[0].is_correct, undefined);
    const broken = studentQuestion({ id: 'q2', type: 'true_false', metadata: { true_false_labels: { true: 'Ya', false: 'Ya' } }, bank_question_options: options }, 'seed');
    assert.deepEqual(broken.metadata, {});
    const mcq = studentQuestion({ id: 'q3', type: 'mcq', metadata: { true_false_labels: { true: 'True', false: 'False' } }, bank_question_options: options }, 'seed');
    assert.deepEqual(mcq.metadata, {});
});

test('imported B/S questions without a LABEL row follow the bank subject', () => {
    assert.deepEqual(trueFalseLabelsForSubject('Bahasa Inggris'), { true: 'True', false: 'False' });
    assert.deepEqual(trueFalseLabelsForSubject('English'), { true: 'True', false: 'False' });
    assert.deepEqual(trueFalseLabelsForSubject('Bahasa Arab'), { true: 'صحيح', false: 'خطأ' });
    assert.equal(trueFalseLabelsForSubject('Matematika'), null);
    assert.equal(trueFalseLabelsForSubject(null), null);
    // Tanpa baris LABEL → mapel; baris LABEL selalu menang, termasuk "Benar | Salah".
    assert.deepEqual(importedTrueFalseLabels(undefined, 'Bahasa Inggris'), { true: 'True', false: 'False' });
    assert.equal(importedTrueFalseLabels(undefined, 'Matematika'), null);
    assert.deepEqual(importedTrueFalseLabels({ true: 'Fakta', false: 'Opini' }, 'Bahasa Inggris'), { true: 'Fakta', false: 'Opini' });
    assert.equal(importedTrueFalseLabels({ true: 'Benar', false: 'Salah' }, 'Bahasa Inggris'), null);
});

test('bulk label change updates only B/S questions, keeps answers, and refreshes live exams', async () => {
    const { fixtureDb } = require('./fixture-db.cjs');
    const { QuestionsService } = require('../src/questions/questions.service.ts');
    const options = [{ id: 'o1', question_id: 'q1', option_text: 'Sun rises east', is_correct: true, weight: 1, order: 0, metadata: {} }];
    const q1 = { id: 'q1', bank_id: 'bank', type: 'true_false', question_text: 'Q1', score_default: 1, revision: 1, metadata: { order_index: 0 }, bank_question_options: options };
    const q2 = { id: 'q2', bank_id: 'bank', type: 'true_false', question_text: 'Q2', score_default: 1, revision: 4, metadata: { true_false_labels: { true: 'True', false: 'False' } }, bank_question_options: [] };
    const q3 = { id: 'q3', bank_id: 'bank', type: 'mcq', question_text: 'Q3', score_default: 1, revision: 1, metadata: {}, bank_question_options: [] };
    const db = fixtureDb({
        cbt_question_banks: [{ id: 'bank', organization_id: 'school' }],
        cbt_bank_questions: [q1, q2, q3], cbt_bank_question_options: options,
        cbt_exams: [{ id: 'live', organization_id: 'school', status: 'active', end_time: '2026-09-20T01:00:00Z', metadata: {} }],
        cbt_exam_question_snapshots: [{ exam_id: 'live', question_id: 'q1', order_number: 1, question_snapshot: structuredClone(q1) }],
        cbt_exam_attempts: [],
    }, [], { now: '2026-09-20T00:30:00Z' });
    const service = new QuestionsService(db, { assertBankAccess: async () => 'school' }, {});
    const user = { id: 'teacher' };
    const byId = id => db.tables.cbt_bank_questions.find(q => q.id === id);

    const result = await service.setTrueFalseLabels(user, 'bank', ['q1', 'q2', 'q3'], { true: 'True', false: 'False' });
    assert.equal(result.updated, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.updatedExams, 1);
    assert.deepEqual(byId('q1').metadata, { order_index: 0, true_false_labels: { true: 'True', false: 'False' } });
    assert.equal(byId('q1').revision, 2);
    assert.equal(byId('q2').revision, 4);
    assert.deepEqual(byId('q3').metadata, {});
    assert.deepEqual(db.tables.cbt_exam_question_snapshots[0].question_snapshot.metadata.true_false_labels, { true: 'True', false: 'False' });
    assert.equal(db.tables.cbt_bank_question_options[0].is_correct, true);

    const reset = await service.setTrueFalseLabels(user, 'bank', ['q1', 'q2'], null);
    assert.equal(reset.updated, 2);
    assert.equal(byId('q1').metadata.true_false_labels, undefined);
    assert.equal(byId('q2').metadata.true_false_labels, undefined);

    await assert.rejects(service.setTrueFalseLabels(user, 'bank', ['q1'], { true: 'Ya', false: 'ya' }), /Label jawaban tidak valid/);
});
