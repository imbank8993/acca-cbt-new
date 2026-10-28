const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { dashboardScoreSummaries } = require('../../web/lib/student-dashboard-score.ts');

const result = (type, score, extra = {}) => ({
    status: 'submitted', needs_manual_grading: false, score_type: type, display_score: score,
    exams: { show_results: true, scoring_type: type }, ...extra,
});
const mixed = [result('irt_1pl', 350), result('classical', 70), result('irt_1pl', 450), result('classical', 90), result('irt_2pl', 600)];

test('student averages separate classical and every IRT model with independent denominators', () => {
    const expected = [
        { type: 'classical', label: 'Klasikal', count: 2, average: 80 },
        { type: 'irt_1pl', label: 'IRT 1PL', count: 2, average: 400 },
        { type: 'irt_2pl', label: 'IRT 2PL', count: 1, average: 600 },
    ];
    assert.deepEqual(dashboardScoreSummaries(mixed), expected);
    assert.deepEqual(dashboardScoreSummaries([...mixed].reverse()), expected);
});

test('unreleased, unfinished, pending and missing scores never enter average groups; zero does', () => {
    const hidden = result('irt_3pl', 700, { exams: { show_results: false } });
    const pending = result('irt_1pl', 800, { needs_manual_grading: true });
    const working = result('classical', 100, { status: 'in_progress' });
    const absent = result('classical', null, { total_score: 100, score_irt: 700 });
    const invalid = result('classical', 101);
    const nan = result('irt_1pl', NaN);
    assert.deepEqual(dashboardScoreSummaries([hidden, pending, working, absent, invalid, nan]), []);
    assert.deepEqual(dashboardScoreSummaries([hidden, pending, result('classical', 0)]), [
        { type: 'classical', label: 'Klasikal', count: 1, average: 0 },
    ]);
});

function renderAverages(results) {
    const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/student/StudentScoreAverages.tsx'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', 'React', code)(name => {
        if (name === 'lucide-react') return { Award: 'Award' };
        if (name.endsWith('/student-dashboard-score')) return { dashboardScoreSummaries };
        throw Error(name);
    }, mod, mod.exports, React);
    return mod.exports.StudentScoreAverages({ results });
}
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : text(tree.children);

test('student summary visibly labels each model and its exam count, with an explicit empty state', () => {
    const content = text(renderAverages(mixed));
    assert.match(content, /Klasikal80\/100Dari 2 ujian/);
    assert.match(content, /IRT 1PL400200–800Dari 2 ujian/);
    assert.match(content, /IRT 2PL600200–800Dari 1 ujian/);
    assert.match(text(renderAverages([])), /Belum ada nilai yang tersedia/);
});
