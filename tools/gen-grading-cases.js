// Bangkitkan kasus uji untuk membandingkan mesin penilaian TypeScript vs Python.
const fs = require('fs');
const ts = require('C:/Users/imran/AppData/Local/Temp/grading-ts.cjs');

let seed = 20260916;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const id = (p, i) => `${p}-${i}`;

function options(n, opts = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: id('opt', i),
    option_text: `Opsi ${i}`,
    is_correct: opts.correctIndex === undefined ? rnd() < 0.3 : i === opts.correctIndex,
    weight: opts.weights ? Math.floor(rnd() * 5) : null,
    order: i,
    metadata: opts.metadata ? opts.metadata(i) : {},
  }));
}

const cases = [];
const push = (question, raw_answer, label) => cases.push({ label, question, raw_answer });

// ── mcq ──────────────────────────────────────────────────────────────────────
for (let i = 0; i < 6; i++) {
  const o = options(4, { correctIndex: 1 });
  push({ id: id('q', i), type: 'mcq', score_default: 1 + i, metadata: {}, bank_question_options: o },
    pick([o[0].id, o[1].id, null, '', 'tidak-ada']), 'mcq');
}

// ── mcq_complex (termasuk bentuk warisan) ────────────────────────────────────
for (const raw of [
  JSON.stringify(['opt-0', 'opt-2']), JSON.stringify(['opt-0']), 'opt-0',
  'opt-0,opt-2', '', null, '[]', '"opt-0"', 'bukan-json',
]) {
  const o = options(4, { metadata: () => ({}) });
  o[0].is_correct = true; o[2].is_correct = true; o[1].is_correct = false; o[3].is_correct = false;
  push({ id: 'qc', type: 'mcq_complex', score_default: 4, metadata: {}, bank_question_options: o }, raw, 'mcq_complex');
}

// ── true_false ───────────────────────────────────────────────────────────────
for (const raw of [
  JSON.stringify({ 'opt-0': true, 'opt-1': false, 'opt-2': true }),
  JSON.stringify({ 'opt-0': 'true', 'opt-1': 'salah' }),
  JSON.stringify({}), null, 'rusak',
]) {
  const o = options(3);
  o[0].is_correct = true; o[1].is_correct = false; o[2].is_correct = true;
  push({ id: 'qtf', type: 'true_false', score_default: 6, metadata: {}, bank_question_options: o }, raw, 'true_false');
}

// ── categorization ───────────────────────────────────────────────────────────
for (const raw of [
  JSON.stringify({ 'opt-0': ['A'], 'opt-1': ['B'] }),
  JSON.stringify({ 'opt-0': ['A', 'B'] }), null, '{}',
]) {
  const o = options(2, { metadata: (i) => (i === 0 ? { category_names: ['A'] } : { category_name: 'B' }) });
  push({ id: 'qcat', type: 'categorization', score_default: 4, metadata: {}, bank_question_options: o }, raw, 'categorization');
}

// ── matching ─────────────────────────────────────────────────────────────────
for (const raw of [
  JSON.stringify({ 'opt-0': ['X'], 'opt-1': ['Y'] }),
  JSON.stringify({ 'opt-0': ['Z'] }), null,
]) {
  const o = options(2, { metadata: (i) => (i === 0 ? { match_texts: ['X'] } : { match_text: 'Y' }) });
  push({ id: 'qm', type: 'matching', score_default: 2, metadata: {}, bank_question_options: o }, raw, 'matching');
}

// ── short_answer (termasuk kredit parsial 0,5) ───────────────────────────────
const blanks = { blanks: [{ answer: 'Jakarta', variations: ['DKI Jakarta'] }, { answer: 'Sumatera', variations: [] }] };
for (const raw of [
  JSON.stringify(['Jakarta', 'Sumatera']), JSON.stringify(['jakarta ', 'sumatera']),
  JSON.stringify(['DKI Jakarta', 'Sumat']), JSON.stringify(['', '']),
  JSON.stringify(['Jakarta']), 'Jakarta', null, '',
]) {
  push({ id: 'qsa', type: 'short_answer', score_default: 10, metadata: blanks, bank_question_options: [] }, raw, 'short_answer');
}

// ── likert ───────────────────────────────────────────────────────────────────
for (const raw of ['1', '3', '5', '0', '6', 'abc', null]) {
  push({ id: 'ql', type: 'likert', score_default: 1, dimension_id: 'dim-1', metadata: {}, bank_question_options: [] }, raw, 'likert');
}

// ── checklist ────────────────────────────────────────────────────────────────
for (const raw of [JSON.stringify(['opt-0', 'opt-1']), JSON.stringify(['opt-0']), '[]', null, 'rusak']) {
  const o = options(3, { weights: true, metadata: (i) => ({ dimension_id: `dim-${i % 2}` }) });
  push({ id: 'qcl', type: 'checklist', score_default: 1, metadata: {}, bank_question_options: o }, raw, 'checklist');
}

// ── sjt ──────────────────────────────────────────────────────────────────────
for (const raw of ['opt-0', 'opt-1', ' opt-2 ', null, 'tidak-ada']) {
  const o = options(3, { weights: true });
  o[0].weight = 3; o[1].weight = 0; o[2].weight = 5;
  push({ id: 'qs', type: 'sjt', score_default: 1, dimension_id: 'dim-s', metadata: {}, bank_question_options: o }, raw, 'sjt');
}

// ── forced_choice / paired_comparison ────────────────────────────────────────
for (const type of ['forced_choice', 'paired_comparison']) {
  for (const raw of ['opt-0', 'opt-1', null]) {
    const o = options(2, { metadata: (i) => ({ dimension_id: `dim-f${i}` }) });
    o[0].weight = 2; o[1].weight = null;
    push({ id: 'qf', type, score_default: 1, metadata: {}, bank_question_options: o }, raw, type);
  }
}

// ── ordering / ranking ───────────────────────────────────────────────────────
for (const raw of [
  JSON.stringify(['opt-0', 'opt-1', 'opt-2']), JSON.stringify(['opt-2', 'opt-1', 'opt-0']),
  JSON.stringify(['opt-0']), null, 'opt-0',
]) {
  const o = options(3, { metadata: (i) => ({ dimension_id: `dim-r${i}` }) });
  push({ id: 'qo', type: 'ordering', score_default: 3, metadata: {}, bank_question_options: o }, raw, 'ordering');
  push({ id: 'qo2', type: 'ordering', score_default: 3, metadata: { correct_order: ['opt-2', 'opt-0', 'opt-1'] }, bank_question_options: o }, raw, 'ordering-explicit');
  push({ id: 'qr', type: 'ranking', score_default: 3, metadata: {}, bank_question_options: o }, raw, 'ranking');
}

// ── essay ────────────────────────────────────────────────────────────────────
for (const type of ['essay', 'esay', 'uraian']) {
  push({ id: 'qe', type, score_default: 10, metadata: {}, bank_question_options: [] }, 'jawaban panjang', type);
}

// ── opsi kembar (dedup berdasarkan id) ───────────────────────────────────────
{
  const o = options(2, { correctIndex: 0 });
  push({ id: 'qd', type: 'mcq', score_default: 1, metadata: {}, bank_question_options: [...o, o[0], o[1]] }, 'opt-0', 'mcq-duplikat');
}

const results = cases.map((c) => {
  const r = ts.calculateSingleAnswerScore(c.question, c.raw_answer);
  return {
    label: c.label,
    score: r.score,
    isCorrect: r.isCorrect === undefined ? null : r.isCorrect,
    dimensionScores: r.dimensionScores || {},
  };
});

fs.writeFileSync('C:/Users/imran/AppData/Local/Temp/cases.json', JSON.stringify(cases, null, 1));
fs.writeFileSync('C:/Users/imran/AppData/Local/Temp/ts-results.json', JSON.stringify(results, null, 1));
console.log('kasus dibangkitkan:', cases.length);
