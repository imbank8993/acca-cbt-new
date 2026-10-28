const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function harness(hasIrt) {
    let selected;
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
        useState: initial => [selected ??= initial, value => { selected = value; }],
    };
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/monitoring/MonitoringAnalysisView.tsx'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', 'React', code)(name => {
        if (name === 'react') return React;
        if (name.endsWith('/inlineselect')) return { InlineSelect: 'InlineSelect' };
        throw Error(name);
    }, mod, mod.exports, React);
    const render = (enabled = hasIrt) => mod.exports.MonitoringAnalysisView({ hasIrt: enabled, irt: 'IRT parameters', children: 'Classical items' });
    const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.children)];
    const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : text(tree.children);
    return { render, nodes, text };
}

test('mixed analysis switches between IRT and classical instead of rendering both', () => {
    const h = harness(true);
    let tree = h.render();
    let select = h.nodes(tree).find(node => node.type === 'InlineSelect');
    assert.equal(select.props['aria-label'], 'Jenis analisis');
    assert.deepEqual(select.props.options.map(option => option.label), ['IRT', 'Klasikal']);
    assert.match(h.text(tree), /IRT parameters/);
    assert.doesNotMatch(h.text(tree), /Classical items/);
    select.props.onChange('classical');
    tree = h.render();
    assert.match(h.text(tree), /Classical items/);
    assert.doesNotMatch(h.text(tree), /IRT parameters/);
    select = h.nodes(tree).find(node => node.type === 'InlineSelect');
    assert.equal(select.props.value, 'classical');
    select.props.onChange('irt');
    assert.match(h.text(h.render()), /IRT parameters/);
});

test('classical-only exams show analysis directly, including after an IRT exam', () => {
    const h = harness(false);
    assert.match(h.text(h.render()), /Classical items/);
    assert.ok(!h.nodes(h.render()).some(node => node.type === 'InlineSelect'));
    const switched = harness(true);
    switched.render();
    assert.match(switched.text(switched.render(false)), /Classical items/);
    assert.doesNotMatch(switched.text(switched.render(false)), /IRT parameters/);
});
