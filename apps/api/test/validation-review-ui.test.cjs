// Component event test with an in-memory hook host; no browser/database needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

test('Bank summary exposes existing corrections and opens the affected question and session', async () => {
    const state = []; let cursor = 0; let initial = true; const effects = [];
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
        useState(value) { const i = cursor++; if (!(i in state)) state[i] = value; return [state[i], next => { state[i] = next; }]; },
        useEffect(fn) { if (initial) effects.push(fn); }, useCallback: fn => fn,
    };
    const api = { getBankValidationFeedback: async () => [{ id: 'legacy-session', title: 'Validasi Matematika', notes: [
        { id: 'note', question_id: 'q2', status_item: 'revision', target_scope: 'option', selected_text: 'Bagian salah', comment: 'Perbaiki pilihan', is_resolved: false },
        { id: 'resolved', question_id: 'q1', status_item: 'revision', comment: 'Selesai', is_resolved: true },
        { id: 'valid', question_id: 'q1', status_item: 'valid', comment: 'Sudah tepat', is_resolved: false },
    ] }] };
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/questions/BankValidationSummary.tsx'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'window', code)(name => name === 'react' ? React : api, module, module.exports, { addEventListener() {}, removeEventListener() {} });
    const questions = [{ id: 'q1' }, { id: 'q2' }]; const opened = [];
    const render = () => { cursor = 0; const tree = module.exports.default({ bankId: 'bank', questions, onEditQuestion: q => opened.push(q), onOpenFeedback: id => opened.push(id) }); initial = false; return tree; };
    const nodes = root => !root || typeof root !== 'object' ? [] : Array.isArray(root) ? root.flatMap(nodes) : [root, ...nodes(root.children)];
    const text = root => root == null || typeof root === 'boolean' ? '' : typeof root !== 'object' ? String(root) : Array.isArray(root) ? root.map(text).join('') : text(root.children);
    render(); effects.forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve));
    const tree = render();
    assert.match(text(tree), /1 catatan perlu perbaikan pada 1 soal/);
    assert.match(text(tree), /Soal 2 · Pilihan jawaban/);
    assert.match(text(tree), /Bagian salah/);
    assert.doesNotMatch(text(tree), /Selesai|Sudah tepat/);
    nodes(tree).find(n => n.type === 'button' && text(n).includes('Buka soal')).props.onClick();
    nodes(tree).find(n => n.type === 'button' && text(n).includes('Lihat catatan')).props.onClick();
    assert.deepEqual(opened, [questions[1], 'legacy-session']);
});

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

function loadReviewPage(reviewData, apiOverrides = {}) {
    const state = []; let cursor = 0; let firstRender = true; const effects = [];
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
        useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
        useRef(initial) { const index = cursor++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
        useEffect(fn) { if (firstRender) effects.push(fn); },
        useMemo: fn => fn(), useCallback: fn => fn,
    };
    const api = { getValidationReviewData: async () => reviewData, ...apiOverrides };
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/dashboard/guru/validations/[id]/review/page.tsx'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'window', code)(name => {
        if (name === 'react') return React;
        if (name === 'next/navigation') return { useParams: () => ({ id: 's' }), useRouter: () => ({ push() {} }) };
        if (name === '@/lib/api/validations') return api;
        if (name === '@/lib/confirm-dialog') return { confirmDialog: async () => true };
        return new Proxy({}, { get: (_, key) => key });
    }, module, module.exports, { getSelection: () => ({ removeAllRanges() {} }) });
    const nodes = root => !root || typeof root !== 'object' ? [] : Array.isArray(root) ? root.flatMap(nodes) : [root, ...nodes(root.children)];
    const text = root => root == null || typeof root === 'boolean' ? '' : typeof root !== 'object' ? String(root) : Array.isArray(root) ? root.map(text).join('') : text(root.children);
    const render = () => { cursor = 0; const tree = module.exports.default(); firstRender = false; return tree; };
    const start = async () => { render(); effects.forEach(effect => effect()); await new Promise(resolve => setImmediate(resolve)); return render(); };
    return { render, start, nodes, text };
}
const reviewQuestions = [{ id: 'q1', question_text: 'First', bank_question_options: [{ id: 'o1', option_text: 'Option' }] }];
const reviewNotes = [
    { id: 'mine', question_id: 'q1', validator_id: 'v', category: 'typo', comment: 'Catatan saya', is_resolved: false },
    { id: 'theirs', question_id: 'q1', validator_id: 'other', category: 'typo', comment: 'Catatan validator lain', is_resolved: false },
    { id: 'fixed', question_id: 'q1', validator_id: 'v', category: 'typo', comment: 'Sudah diperbaiki', is_resolved: true },
];
const deleteButtons = (page, tree) => page.nodes(tree).filter(n => n.type === 'button' && n.props.title === 'Hapus Catatan');

test('Review page is read-only for non-validators and after the deadline', async () => {
    for (const data of [
        { validation: { id: 's', title: 'Test' }, myValidatorStatus: null, notes: reviewNotes, questions: reviewQuestions },
        { validation: { id: 's', title: 'Test', deadline: '2020-01-01T00:00:00Z' }, myValidatorStatus: { validator_id: 'v', status: 'in_progress' }, notes: reviewNotes, questions: reviewQuestions },
    ]) {
        const page = loadReviewPage(data);
        const tree = await page.start();
        assert.equal(page.nodes(tree).some(n => n.type === 'textarea'), false);
        assert.equal(page.nodes(tree).some(n => n.type === 'Button' && /Selesaikan|Perbarui/.test(page.text(n))), false);
        assert.equal(deleteButtons(page, tree).length, 0);
        assert.match(page.text(tree), /lihat saja|Batas waktu/);
    }
});

test('Validators can delete only their own unresolved notes and see delete failures', async () => {
    let fail = true; const deleted = [];
    const page = loadReviewPage(
        { validation: { id: 's', title: 'Test' }, myValidatorStatus: { validator_id: 'v', status: 'submitted' }, notes: reviewNotes, questions: reviewQuestions },
        { deleteValidationNote: async (_, id) => { deleted.push(id); return fail ? { success: false, error: 'Catatan tidak dapat dihapus' } : { success: true, id, deleted: true }; } },
    );
    let tree = await page.start();
    assert.match(page.text(tree), /Perbarui Hasil Validasi/);
    assert.equal(deleteButtons(page, tree).length, 1);
    await deleteButtons(page, tree)[0].props.onClick();
    tree = page.render();
    assert.match(page.text(tree), /Catatan tidak dapat dihapus/);
    assert.match(page.text(tree), /Catatan saya/);
    fail = false;
    await deleteButtons(page, tree)[0].props.onClick();
    tree = page.render();
    assert.doesNotMatch(page.text(tree), /Catatan saya/);
    assert.deepEqual(deleted, ['mine', 'mine']);
});

test('Final submission failure stays in the modal with the server message', async () => {
    const page = loadReviewPage(
        { validation: { id: 's', title: 'Test' }, myValidatorStatus: { validator_id: 'v', status: 'in_progress' }, notes: [], questions: reviewQuestions },
        { submitValidationReview: async () => ({ success: false, error: 'Batas waktu validasi telah berakhir.' }) },
    );
    let tree = await page.start();
    page.nodes(tree).find(n => n.type === 'Button' && /Selesaikan Validasi/.test(page.text(n))).props.onClick();
    tree = page.render();
    await page.nodes(tree).find(n => n.type === 'Button' && /Kirim Hasil Validasi/.test(page.text(n))).props.onClick();
    tree = page.render();
    assert.match(page.text(tree), /Batas waktu validasi telah berakhir/);
    assert.ok(page.nodes(tree).some(n => n.type === 'Button' && /Kirim Hasil Validasi/.test(page.text(n))));
});

test('Load failures show the server reason instead of a generic access denial', async () => {
    const page = loadReviewPage(null, { getValidationReviewData: async () => { throw new Error('Tidak dapat menghubungi server.'); } });
    const tree = await page.start();
    assert.match(page.text(tree), /Tidak dapat menghubungi server/);
});
