// Component event test with an in-memory hook host; no browser/database needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

test('Question navigation isolates and restores drafts and option targets', async () => {
    const state = []; let cursor = 0; let firstRender = true; const effects = []; const saved = [];
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
        useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
        useRef(initial) { const index = cursor++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
        useEffect(fn) { if (firstRender) effects.push(fn); },
        useMemo: fn => fn(), useCallback: fn => fn,
    };
    const api = {
        getValidationReviewData: async () => ({ validation: { id: 's', title: 'Test' }, myValidatorStatus: { validator_id: 'v' }, notes: [], questions: [
            { id: 'q1', question_text: 'First', bank_question_options: [{ id: 'o1', option_text: 'Option' }] },
            { id: 'q2', question_text: 'Second', bank_question_options: [] },
        ] }),
        saveValidationNote: async (id, payload) => { saved.push(payload); return { success: true, id: 'note', question_id: payload.questionId, category: 'typo' }; },
    };
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/dashboard/guru/validations/[id]/review/page.tsx'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'window', code)(name => {
        if (name === 'react') return React;
        if (name === 'next/navigation') return { useParams: () => ({ id: 's' }), useRouter: () => ({ push() {} }) };
        if (name === '@/lib/api/validations') return api;
        return new Proxy({}, { get: (_, key) => key });
    }, module, module.exports, { getSelection: () => ({ removeAllRanges() {} }) });
    const render = () => { cursor = 0; const tree = module.exports.default(); firstRender = false; return tree; };
    const nodes = root => !root || typeof root !== 'object' ? [] : Array.isArray(root) ? root.flatMap(nodes) : [root, ...nodes(root.children)];
    const text = root => root == null || typeof root === 'boolean' ? '' : typeof root !== 'object' ? String(root) : Array.isArray(root) ? root.map(text).join('') : text(root.children);
    const find = (tree, predicate) => { const result = nodes(tree).find(predicate); assert.ok(result, 'UI target exists'); return result; };
    let tree = render();
    effects.forEach(effect => effect());
    await new Promise(resolve => setImmediate(resolve));
    tree = render();
    find(tree, n => n.type === 'div' && n.props.onClick && nodes(n).some(child => child.props?.content === 'Option')).props.onClick();
    tree = render();
    find(tree, n => n.type === 'textarea').props.onChange({ target: { value: 'Draft for first question' } });
    tree = render();
    find(tree, n => n.type === 'button' && text(n).includes('Selanjutnya')).props.onClick();
    tree = render();
    assert.equal(find(tree, n => n.type === 'textarea').props.value, '');
    find(tree, n => n.type === 'textarea').props.onChange({ target: { value: 'Note for second question' } });
    tree = render();
    await find(tree, n => n.type === 'Button' && text(n).includes('Simpan Catatan')).props.onClick();
    assert.equal(saved[0].questionId, 'q2');
    assert.equal(saved[0].targetScope, 'question_text');
    assert.equal(saved[0].targetOptionId, undefined);
    tree = render();
    find(tree, n => n.type === 'button' && text(n).includes('Sebelumnya')).props.onClick();
    tree = render();
    assert.equal(find(tree, n => n.type === 'textarea').props.value, 'Draft for first question');
    await find(tree, n => n.type === 'Button' && text(n).includes('Simpan Catatan')).props.onClick();
    assert.equal(saved[1].questionId, 'q1');
    assert.equal(saved[1].targetOptionId, 'o1');
    assert.equal(saved[1].targetScope, 'option');
});

test('Author editor panel selects history, scopes notes and exposes resolve failures', async () => {
    const state = []; let cursor = 0; let initial = true; const effects = []; let fail = false;
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
        useState(value) { const i = cursor++; if (!(i in state)) state[i] = typeof value === 'function' ? value() : value; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
        useEffect(fn) { if (initial) effects.push(fn); }, useCallback: fn => fn,
    };
    const calls = [];
    const api = {
        getBankValidationFeedback: async () => ['new', 'old'].map(id => ({ id, title: id, created_at: '2026-10-13', notes: [
            { id: id + '-note', question_id: 'q1', comment: id + ' correction', is_resolved: false },
            { id: 'foreign', question_id: 'q2', comment: 'other question' },
        ] })),
        resolveValidationNote: async (id, resolved) => { calls.push([id, resolved]); return fail ? { success: false, error: 'Save failed' } : { success: true }; },
    };
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/questions/ValidationNotesPanel.tsx'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    new Function('require','module','exports','window',code)(name => name === 'react' ? React : api, module, module.exports, { location: { search: '' }, dispatchEvent() {} });
    const render = () => { cursor = 0; const tree = module.exports.ValidationNotesPanel({ bankId: 'bank', questionId: 'q1' }); initial = false; return tree; };
    const nodes = root => !root || typeof root !== 'object' ? [] : Array.isArray(root) ? root.flatMap(nodes) : [root, ...nodes(root.children)];
    const text = root => root == null || typeof root === 'boolean' ? '' : typeof root !== 'object' ? String(root) : Array.isArray(root) ? root.map(text).join('') : text(root.children);
    render(); effects.forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve));
    let tree = render(); assert.match(text(tree), /new correction/); assert.doesNotMatch(text(tree), /other question/);
    nodes(tree).find(n => n.type === 'select').props.onChange({ target: { value: 'old' } });
    tree = render(); assert.match(text(tree), /old correction/);
    fail = true; await nodes(tree).find(n => n.type === 'button' && text(n).includes('Tandai')).props.onClick();
    tree = render(); assert.match(text(tree), /Save failed/); assert.match(text(tree), /Tandai sudah/);
    fail = false; await nodes(tree).find(n => n.type === 'button' && text(n).includes('Tandai')).props.onClick();
    tree = render(); assert.match(text(tree), /Batalkan tanda/); assert.deepEqual(calls[1], ['old-note', true]);
});
