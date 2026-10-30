const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const calibrationUtils = require('../../web/lib/irt-calibration.ts');
const { getQuestionSnippet } = require('../../web/lib/question-snippet.ts');
const item = { item_id: 'q1_opt1', question_id: 'q1', option_id: 'opt1', number: 1, part: 'Truncated...', type: 'true_false',
    text: 'Truncated...', total: 206, correct: 100, p: 0.4854, a: 1.25, b: -1.234, c: 0.25, flags: ['Perlu ditinjau'] };
const irt = { calculated_at: '2026-10-28T14:16:00Z', participant_count: 206, models: ['irt_1pl', 'irt_3pl'], warnings: [],
    items: Array.from({ length: 20 }, (_, i) => ({ ...item, item_id: `item-${i}`, number: i + 1, flags: i ? [] : item.flags })) };
const fullQuestion = '<p>Tentukan $\\dfrac{x^2-4}{x-2}$ untuk $x \\ne 2$. ' + 'Teks lengkap. '.repeat(20) + '</p>';
const questions = [{ id: 'q1', qText: fullQuestion, options: [{ id: 'opt1', option_text: '$x+2$' }] }];

test('IRT presentation uses complete source questions and statements without modifying calibration values', () => {
    const report = calibrationUtils.withIrtQuestionText(irt, questions);
    assert.equal(report.items[0].text, fullQuestion);
    assert.equal(report.items[0].part, '$x+2$');
    for (const key of ['a', 'b', 'c', 'p', 'total', 'correct']) assert.equal(report.items[0][key], item[key]);
    assert.equal(irt.items[0].text, 'Truncated...');
    assert.equal(irt.items[0].part, 'Truncated...');
    assert.deepEqual(calibrationUtils.withIrtQuestionText(irt).items, irt.items);
    assert.equal(calibrationUtils.withIrtQuestionText(irt, [{ id: 'other', qText: 'Other question' }]).items[0].text, 'Truncated...');
});

function harness() {
    const state = []; let cursor = 0; const exports = [];
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
        useState: initial => { const index = cursor++; if (!(index in state)) state[index] = initial;
            return [state[index], value => { state[index] = value; }]; },
    };
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/monitoring/IrtParametersPanel.tsx'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', 'React', code)(name => {
        if (name === 'react') return React;
        if (name.endsWith('/irt-calibration')) return calibrationUtils;
        if (name.endsWith('/question-snippet')) return { getQuestionSnippet };
        if (name.endsWith('/export-irt-pdf')) return { exportIrtParametersToPdf: async (...args) => { exports.push(args); } };
        return new Proxy({}, { get: (_, key) => key });
    }, mod, mod.exports, React);
    const render = () => { cursor = 0; return mod.exports.IrtParametersPanel({ calibration: irt, questions, exportTitle: 'Matematika', timeZone: 'Asia/Makassar' }); };
    const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.children)];
    const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : text(tree.children);
    return { render, nodes, text, exports };
}

test('IRT panel renders compact question and statement previews and omits the lengthy explanation', () => {
    const h = harness(), tree = h.render();
    assert.ok(!h.nodes(tree).some(node => node.type === 'details'));
    const maths = h.nodes(tree).filter(node => node.type === 'LatexRenderer');
    assert.equal(maths.length, 30, '15 visible items, with question and statement previews');
    assert.equal(maths[0].props.text, getQuestionSnippet(fullQuestion, 160));
    assert.ok(maths[0].props.text.length < fullQuestion.length);
    assert.ok(maths[0].props.text.endsWith('…'));
    assert.match(maths[0].props.className, /line-clamp-3/);
    assert.equal(maths[1].props.text, '$x+2$');
    assert.match(maths[1].props.className, /line-clamp-2/);
    assert.doesNotMatch(h.text(tree), /Cara membaca angka ini|Kemampuan siswa/);
});

test('PDF export includes all calibrated items, independently of pagination and review filters', async () => {
    const h = harness(); let tree = h.render();
    h.nodes(tree).find(node => node.type === 'input').props.onChange({ target: { checked: true } });
    tree = h.render();
    assert.equal(h.nodes(tree).filter(node => node.type === 'LatexRenderer').length, 2);
    const button = h.nodes(tree).find(node => node.type === 'Button');
    assert.equal(h.text(button), 'Export PDF');
    button.props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.exports.length, 1);
    assert.equal(h.exports[0][0].items.length, 20);
    assert.equal(h.exports[0][0].items[0].text, fullQuestion);
    assert.deepEqual(h.exports[0].slice(1), ['Matematika', 'Asia/Makassar']);
    assert.equal(h.nodes(h.render()).find(node => node.type === 'Button').props.isLoading, false);
});
