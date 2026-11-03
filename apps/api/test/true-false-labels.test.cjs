const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const {
    normalizeTrueFalseLabels, trueFalseLabels, parseTrueFalseKey, trueFalseLabelPreset, isRtlLabel,
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
