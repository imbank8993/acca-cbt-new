const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { Schema } = require('@tiptap/pm/model');
const { EditorState, TextSelection, Plugin } = require('@tiptap/pm/state');
const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/questions/TipTapEditorCore.tsx'), 'utf8');
const ast = ts.createSourceFile('editor.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = {};
function visit(node) {
    if (ts.isVariableDeclaration(node)) declarations[node.name.getText(ast)] = node.initializer?.getText(ast);
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'mathRangesAround') declarations.mathRangesFunction = node.getText(ast);
    ts.forEachChild(node, visit);
}
visit(ast);
const code = `const MATH_PATTERN = ${declarations.MATH_PATTERN}; ${declarations.mathRangesFunction}
const MathHighlighter = ${declarations.MathHighlighter};
module.exports = { ranges: mathRangesAround, plugin: MathHighlighter.addProseMirrorPlugins()[0],
    callbacks(editor, target) {
        const editingMath = { current: target }, useCallback = fn => fn, closeMathModal = () => {};
        const currentEditingMath = ${declarations.currentEditingMath};
        const insertMath = ${declarations.insertMath};
        const deleteEditingMath = ${declarations.deleteEditingMath};
        return { insertMath, deleteEditingMath };
    }
};`;
const moduleHost = { exports: {} };
new Function('module', 'Extension', 'Plugin', ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(moduleHost, { create: config => config }, Plugin);
const math = moduleHost.exports;
const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: { inline: true } } });
const document = text => schema.node('doc', null, [schema.node('paragraph', null, [schema.text(text)])]);
function view(doc, pos) {
    const result = { state: EditorState.create({ doc, selection: TextSelection.create(doc, pos) }) };
    result.dispatch = transaction => { result.state = result.state.apply(transaction); };
    return result;
}

test('Backspace and Delete remove the entire highlighted formula at its boundaries', () => {
    const doc = document('A $x^2$ Z'), range = math.ranges(doc, 4)[0];
    for (const [key, pos] of [['Backspace', range.to], ['Delete', range.from]]) {
        const editorView = view(doc, pos);
        assert.equal(math.plugin.props.handleKeyDown(editorView, { key }), true);
        assert.equal(editorView.state.doc.textContent, 'A  Z');
    }
    assert.equal(math.plugin.props.handleKeyDown(view(doc, 1), { key: 'Backspace' }), false);
});

test('typing inside a hidden formula moves the new text after the intact formula', () => {
    const doc = document('A $x^2$ Z'), range = math.ranges(doc, 4)[0], editorView = view(doc, range.from + 2);
    assert.equal(math.plugin.props.handleTextInput(editorView, range.from + 2, range.from + 2, 't'), true);
    assert.equal(editorView.state.doc.textContent, 'A $x^2$t Z');
});

function trackedEditor(doc) {
    const calls = [], chain = { focus() { return this; }, run() { return true; } };
    for (const method of ['insertContentAt', 'insertContent', 'deleteRange']) chain[method] = (...args) => { calls.push([method, ...args]); return chain; };
    return { state: { doc }, chain: () => chain, calls };
}

test('editing the second identical formula replaces that range and inserts LaTeX as plain text', () => {
    const doc = document('$x$ and $x$'), ranges = math.ranges(doc, 2), editor = trackedEditor(doc);
    assert.equal(ranges.length, 2);
    math.callbacks(editor, ranges[1]).insertMath('x < 3', false);
    assert.deepEqual(editor.calls, [['insertContentAt', { from: ranges[1].from, to: ranges[1].to }, { type: 'text', text: '$x < 3$' }]]);
});

test('explicit delete and clearing the edited formula delete its range without adding another formula', () => {
    const doc = document('$x$'), range = math.ranges(doc, 2)[0];
    for (const clear of [false, true]) {
        const editor = trackedEditor(doc), callbacks = math.callbacks(editor, range);
        if (clear) callbacks.insertMath('', false); else callbacks.deleteEditingMath();
        assert.deepEqual(editor.calls, [['deleteRange', { from: range.from, to: range.to }]]);
    }
});
