const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { studentQuestion } = require('../src/students/student-question.ts');
const { normalizeShortAnswer } = require('../../web/lib/answer-parser.ts');

test('web normalisation matches the scoring service: trim, lowercase unless case-sensitive', () => {
    assert.equal(normalizeShortAnswer('  Jakarta '), 'jakarta');
    assert.equal(normalizeShortAnswer('  Jakarta ', true), 'Jakarta');
    assert.equal(normalizeShortAnswer(null, true), '');
    const python = fs.readFileSync(path.resolve(__dirname, '../../scoring/app/services/answer_parser.py'), 'utf8');
    assert.match(python, /def normalize_short_answer\(value: str \| None, case_sensitive: bool = False\)/);
    assert.match(python, /metadata\.get\("case_sensitive"\) is True/);
});

test('students get the case-sensitive hint for short answers, never the key', () => {
    const blanks = [{ answer: 'Jakarta', variations: ['DKI Jakarta'] }];
    const sa = studentQuestion({ id: 'q', type: 'short_answer', metadata: { case_sensitive: true, blanks } }, 'seed');
    assert.deepEqual(sa.metadata, { case_sensitive: true });
    assert.deepEqual(studentQuestion({ id: 'q', type: 'short_answer', metadata: { blanks } }, 'seed').metadata, {});
    assert.deepEqual(studentQuestion({ id: 'q', type: 'short_answer', metadata: { case_sensitive: 'yes', blanks } }, 'seed').metadata, {});
    assert.deepEqual(studentQuestion({ id: 'q', type: 'mcq', metadata: { case_sensitive: true } }, 'seed').metadata, {});
});

test('editor offers the option and scoring changes trigger a live regrade', () => {
    const form = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/questions/forms/ShortAnswerForm.tsx'), 'utf8');
    assert.match(form, /Bedakan huruf besar\/kecil/);
    const { questionScoringFingerprint } = require('../src/common/live-exam-question-updates.ts');
    const base = { id: 'q', type: 'short_answer', score_default: 1, metadata: { blanks: [{ answer: 'Jakarta', variations: [] }] } };
    assert.notEqual(questionScoringFingerprint(base), questionScoringFingerprint({ ...base, metadata: { ...base.metadata, case_sensitive: true } }));
});
