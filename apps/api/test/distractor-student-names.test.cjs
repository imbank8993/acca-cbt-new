const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function harness(names) {
    const state = []; let cursor = 0;
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
        useId: () => 'student-list-title',
        useState: initial => {
            const i = cursor++;
            if (!(i in state)) state[i] = initial;
            return [state[i], value => { state[i] = value; }];
        },
    };
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/monitoring/DistractorStudentNames.tsx'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', 'React', code)(name => {
        if (name === 'react') return React;
        if (name.endsWith('monitoring-health')) return { formatStudentName: name => name || 'Tanpa Nama' };
        return new Proxy({}, { get: (_, key) => key });
    }, mod, mod.exports, React);
    const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes)
        : tree.type === 'Modal' && !tree.props.open ? [] : [tree, ...nodes(tree.children)];
    const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree)
        : Array.isArray(tree) ? tree.map(text).join('') : tree.type === 'Modal' && !tree.props.open ? '' : text(tree.children);
    const render = () => { cursor = 0; return mod.exports.DistractorStudentNames({ names, optionLetter:'A', questionNumber:21, isCorrect:true }); };
    return { render, nodes, text };
}

test('distractor shows one student and opens a searchable modal containing all option voters', () => {
    const h = harness(['Ani', 'Budi', 'Siti']);
    let tree = h.render();
    assert.match(h.text(tree), /Ani/);
    assert.match(h.text(tree), /\+2 lainnya/);
    assert.doesNotMatch(h.text(tree), /Budi|Siti/);
    const others = h.nodes(tree).find(node => node.type === 'button');
    assert.equal(others.props['aria-haspopup'],'dialog');
    others.props.onClick();
    tree = h.render();
    const modal = h.nodes(tree).find(node => node.type === 'Modal');
    assert.equal(modal.props.open,true);
    assert.equal(modal.props.title,'Daftar Siswa — Opsi A');
    assert.match(modal.props.subtitle,/Soal No\. 21.*3 siswa/);
    assert.deepEqual(h.nodes(tree).filter(node => node.type === 'li').map(h.text),['1.Ani','2.Budi','3.Siti']);
    h.nodes(tree).find(node => node.type === 'FilterSearch').props.onChange('SITI');
    tree = h.render();
    assert.deepEqual(h.nodes(tree).filter(node => node.type === 'li').map(h.text),['1.Siti']);
    h.nodes(tree).find(node => node.type === 'FilterSearch').props.onChange('tidak ada');
    assert.match(h.text(h.render()),/Tidak ada siswa yang cocok/);
    modal.props.onClose();
    tree = h.render();
    assert.ok(!h.nodes(tree).some(node => node.type === 'Modal'));
    assert.match(h.text(tree), /\+2 lainnya/);
    h.nodes(tree).find(node => node.type === 'button').props.onClick();
    assert.equal(h.nodes(h.render()).filter(node => node.type === 'li').length,3,'Search resets when reopened');
});

test('zero or one voter does not offer an unnecessary others modal', () => {
    assert.equal(harness([]).render(),null);
    const h = harness(['Ani']);
    const tree = h.render();
    assert.match(h.text(tree),/Ani/);
    assert.ok(!h.nodes(tree).some(node => node.type === 'button'));
});
