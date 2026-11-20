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
        setValidationItemStatus: async (id, questionId, status) => ({ success: true, question_id: questionId, validator_id: 'v', status }),
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
    await new Promise(resolve => setTimeout(resolve, 0));
    tree = render();
    // Form catatan baru muncul setelah butir dinilai Perlu revisi / Tolak.
    assert.equal(nodes(tree).some(n => n.type === 'textarea'), false);
    const markRevision = async () => { await find(tree, n => n.type === 'button' && text(n) === 'Perlu revisi').props.onClick(); tree = render(); };
    await markRevision();
    find(tree, n => n.type === 'div' && n.props.onClick && nodes(n).some(child => child.props?.content === 'Option')).props.onClick();
    tree = render();
    find(tree, n => n.type === 'textarea').props.onChange({ target: { value: 'Draft for first question' } });
    tree = render();
    find(tree, n => n.type === 'button' && text(n).includes('Selanjutnya')).props.onClick();
    tree = render();
    await markRevision();
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
            { id: id + '-note', question_id: 'q1', category: 'kunci_jawaban', comment: id + ' correction', is_resolved: false },
            { id: id + '-tip', question_id: 'q1', status_item: 'valid', comment: id + ' suggestion', is_resolved: false },
            { id: 'foreign', question_id: 'q2', comment: 'other question' },
        ] })),
        resolveValidationNote: async (id, resolved) => { calls.push([id, resolved]); return fail ? { success: false, error: 'Save failed' } : { success: true }; },
    };
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/questions/ValidationNotesPanel.tsx'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    // Pemilih sesi kini memakai InlineSelect (bukan <select> bawaan): onChange menerima nilai langsung.
    function InlineSelect() { return null; }
    new Function('require','module','exports','window',code)(name => name === 'react' ? React : name.endsWith('/inlineselect') ? { InlineSelect } : name.endsWith('/validation-status') ? { NOTE_CATEGORY_LABELS: { kunci_jawaban: 'Kunci jawaban' } } : api, module, module.exports, { location: { search: '' }, dispatchEvent() {} });
    const render = () => { cursor = 0; const tree = module.exports.ValidationNotesPanel({ bankId: 'bank', questionId: 'q1' }); initial = false; return tree; };
    const nodes = root => !root || typeof root !== 'object' ? [] : Array.isArray(root) ? root.flatMap(nodes) : [root, ...nodes(root.children)];
    const text = root => root == null || typeof root === 'boolean' ? '' : typeof root !== 'object' ? String(root) : Array.isArray(root) ? root.map(text).join('') : text(root.children);
    render(); effects.forEach(fn => fn()); await new Promise(resolve => setTimeout(resolve, 0));
    let tree = render(); assert.match(text(tree), /new correction/); assert.doesNotMatch(text(tree), /other question/);
    // Saran pada butir Layak diberi label dan tidak punya tombol tandai diperbaiki.
    assert.match(text(tree), /Kunci jawaban/);
    assert.match(text(tree), /Saran · tidak wajib diperbaiki/);
    assert.equal(nodes(tree).filter(n => n.type === 'button' && text(n).includes('Tandai')).length, 1);
    nodes(tree).find(n => n.type === InlineSelect).props.onChange('old');
    tree = render(); assert.match(text(tree), /old correction/);
    fail = true; await nodes(tree).find(n => n.type === 'button' && text(n).includes('Tandai')).props.onClick();
    tree = render(); assert.match(text(tree), /Save failed/); assert.match(text(tree), /Tandai sudah/);
    fail = false; await nodes(tree).find(n => n.type === 'button' && text(n).includes('Tandai')).props.onClick();
    tree = render(); assert.match(text(tree), /Batalkan tanda/); assert.deepEqual(calls[1], ['old-note', true]);
});

function loadConclusion() {
    require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
    return require('../../web/lib/validation-conclusion.ts');
}
function loadReviewPage(reviewData, apiOverrides = {}) {
    const state = []; let cursor = 0; let firstRender = true; const effects = [];
    const React = {
        createElement: (type, props, ...children) => type && type.name === 'ValidationConclusionText' ? type(props || {}) : ({ type, props: props || {}, children }),
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
        if (name === '@/lib/validation-conclusion') return loadConclusion();
        // Kesimpulan ditampilkan lewat komponen: render langsung agar teksnya ikut diperiksa.
        if (name.endsWith('/ValidationConclusionText')) return { ValidationConclusionText: ({ text }) => {
            const { conclusion, suggestion } = loadConclusion().splitGeneralComment(text);
            return React.createElement('div', null, conclusion, suggestion ? ` Saran umum: ${suggestion}` : '');
        } };
        return new Proxy({}, { get: (_, key) => key });
    }, module, module.exports, { getSelection: () => ({ removeAllRanges() {} }) });
    const nodes = root => !root || typeof root !== 'object' ? [] : Array.isArray(root) ? root.flatMap(nodes) : [root, ...nodes(root.children)];
    const text = root => root == null || typeof root === 'boolean' ? '' : typeof root !== 'object' ? String(root) : Array.isArray(root) ? root.map(text).join('') : text(root.children);
    const render = () => { cursor = 0; const tree = module.exports.default(); firstRender = false; return tree; };
    const start = async () => { render(); effects.forEach(effect => effect()); await new Promise(resolve => setTimeout(resolve, 0)); return render(); };
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

test('Submitted reviews are locked until reopened', async () => {
    const page = loadReviewPage(
        { validation: { id: 's', title: 'Test' }, myValidatorStatus: { validator_id: 'v', status: 'submitted' }, notes: reviewNotes, questions: reviewQuestions },
    );
    const tree = await page.start();
    assert.match(page.text(tree), /Hasil validasi terkirim/);
    assert.match(page.text(tree), /Berikutnya:/);
    assert.match(page.text(tree), /Ubah hasil/);
    assert.equal(page.nodes(tree).some(n => n.type === 'textarea'), false);
    assert.equal(deleteButtons(page, tree).length, 0);
});

test('Validators can delete only their own unresolved notes and see delete failures', async () => {
    let fail = true; const deleted = [];
    const page = loadReviewPage(
        { validation: { id: 's', title: 'Test' }, myValidatorStatus: { validator_id: 'v', status: 'in_progress' }, notes: reviewNotes, questions: reviewQuestions },
        { deleteValidationNote: async (_, id) => { deleted.push(id); return fail ? { success: false, error: 'Catatan tidak dapat dihapus' } : { success: true, id, deleted: true }; } },
    );
    let tree = await page.start();
    assert.match(page.text(tree), /Selesaikan Validasi/);
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
    // Tanpa rekomendasi yang dipilih, pengiriman ditahan di sisi klien.
    await page.nodes(tree).find(n => n.type === 'Button' && /Kirim Hasil Validasi/.test(page.text(n))).props.onClick();
    tree = page.render();
    assert.match(page.text(tree), /Pilih rekomendasi/);
    page.nodes(tree).find(n => n.type === 'button' && page.text(n) === 'Perlu Revisi').props.onClick();
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

test('Marking an item Layak saves it and jumps to the next unreviewed item', async () => {
    const calls = [];
    const questions = [{ id: 'q1', question_text: 'First' }, { id: 'q2', question_text: 'Second' }, { id: 'q3', question_text: 'Third' }];
    const page = loadReviewPage(
        { validation: { id: 's', title: 'Test' }, myValidatorStatus: { validator_id: 'v', status: 'in_progress' }, notes: [],
            items: [{ question_id: 'q2', validator_id: 'v', status: 'valid' }], questions },
        { setValidationItemStatus: async (id, questionId, status) => { calls.push([questionId, status]); return { success: true, question_id: questionId, validator_id: 'v', status }; } },
    );
    let tree = await page.start();
    assert.match(page.text(tree), /Selesaikan Validasi \(1\/3\)/);
    assert.match(page.text(tree), /Ke yang belum dinilai \(2\)/);
    await page.nodes(tree).find(n => n.type === 'button' && page.text(n) === 'Layak').props.onClick();
    tree = page.render();
    assert.deepEqual(calls, [['q1', 'valid']]);
    // q2 sudah dinilai, jadi lompat ke q3.
    assert.ok(page.nodes(tree).some(n => n.type === 'QuestionContent' && n.props.content === 'Third'));
    assert.equal(page.nodes(tree).some(n => n.type === 'textarea'), false);
});

test('"Layak, dengan saran" keeps the validator on the item with a suggestion form', async () => {
    const calls = []; const saved = [];
    const questions = [{ id: 'q1', question_text: 'First' }, { id: 'q2', question_text: 'Second' }];
    const page = loadReviewPage(
        { validation: { id: 's', title: 'Test' }, myValidatorStatus: { validator_id: 'v', status: 'in_progress' }, notes: [], items: [], questions },
        {
            setValidationItemStatus: async (id, questionId, status) => { calls.push([questionId, status]); return { success: true, question_id: questionId, validator_id: 'v', status }; },
            saveValidationNote: async (id, payload) => { saved.push(payload); return { success: true, id: 'tip', question_id: payload.questionId, validator_id: 'v', status_item: payload.statusItem, category: payload.category, comment: payload.comment }; },
        },
    );
    let tree = await page.start();
    await page.nodes(tree).find(n => n.type === 'button' && page.text(n) === 'Layak, dengan saran').props.onClick();
    tree = page.render();
    assert.deepEqual(calls, [['q1', 'valid']]);
    assert.ok(page.nodes(tree).some(n => n.type === 'QuestionContent' && n.props.content === 'First'));
    assert.match(page.text(tree), /Saran untuk pembuat soal/);
    page.nodes(tree).find(n => n.type === 'textarea').props.onChange({ target: { value: 'Pertimbangkan pengecoh lain' } });
    tree = page.render();
    await page.nodes(tree).find(n => n.type === 'Button' && page.text(n).includes('Simpan Catatan')).props.onClick();
    assert.equal(saved[0].statusItem, 'valid');
});

test('Admin/Proktor viewers pick a validator and see that validator\'s results read-only', async () => {
    const questions = [{ id: 'q1', question_text: 'First' }, { id: 'q2', question_text: 'Second' }];
    const page = loadReviewPage({
        validation: { id: 's', title: 'Test', validators: [
            { validator_id: 'a', status: 'submitted', general_recommendation: 'approved', general_comment: 'Belum ada soal berbahasa Inggris.', profile: { full_name: 'Guru A' } },
            { validator_id: 'b', status: 'in_progress', general_recommendation: null, profile: { full_name: 'Guru B' } },
        ] },
        myValidatorStatus: null,
        notes: [],
        items: [{ question_id: 'q1', validator_id: 'a', status: 'valid' }, { question_id: 'q2', validator_id: 'a', status: 'revision' }],
        questions,
    });
    let tree = await page.start();
    assert.match(page.text(tree), /Lihat hasil validator/);
    assert.match(page.text(tree), /Rekomendasi: Disetujui/);
    assert.match(page.text(tree), /Belum ada soal berbahasa Inggris/);
    assert.match(page.text(tree), /Dinilai 2\/2/);
    assert.equal(page.nodes(tree).some(n => n.type === 'textarea'), false);
    page.nodes(tree).find(n => n.type === 'InlineSelect' && n.props.id === 'viewed-validator').props.onChange('b');
    tree = page.render();
    assert.match(page.text(tree), /Sedang dikerjakan/);
    assert.match(page.text(tree), /Dinilai 0\/2/);
});

test('Kisi-kisi and short-answer key in the review context render LaTeX through InlineMath', () => {
    const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), Fragment: 'Fragment' };
    const InlineMath = function InlineMath() { return null; };
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/validations/ValidationQuestionContext.tsx'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(name => name === 'react' ? React : name.endsWith('InlineMath') ? { InlineMath } : { QuestionContent: () => null, BookMarked: 'i', KeyRound: 'i', Lightbulb: 'i' }, module, module.exports);
    const nodes = root => !root || typeof root !== 'object' ? [] : Array.isArray(root) ? root.flatMap(nodes) : [root, ...nodes(root.children)];
    const math = tree => nodes(tree).filter(node => node.type === InlineMath).map(node => node.props.text);
    const question = { id: 'q', type: 'short_answer', question_text: '', kisi_kisi: { materi: 'Matriks', indikator_soal: 'Determinan $2\times2$', level_kognitif: 'C3' },
        metadata: { blanks: [{ answer: '$-2$', variations: ['$-\frac{4}{2}$'] }] } };
    assert.deepEqual(math(module.exports.ValidationQuestionContext({ question })), ['Matriks', 'Determinan $2\times2$', 'C3']);
    assert.deepEqual(math(module.exports.ValidationAnswerKey({ question })), ['$-2$', '$-\frac{4}{2}$']);
});

test('Final conclusion and general suggestion share general_comment and split back losslessly', () => {
    require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
    const { composeGeneralComment, splitGeneralComment, GENERAL_SUGGESTION_HEADING } = require('../../web/lib/validation-conclusion.ts');
    const both = composeGeneralComment('  Sudah baik.\nPerbaiki no 3. ', ' Seragamkan opsi.\nTambah C4. ');
    assert.equal(both, `Sudah baik.\nPerbaiki no 3.\n\n${GENERAL_SUGGESTION_HEADING}\nSeragamkan opsi.\nTambah C4.`);
    assert.deepEqual(splitGeneralComment(both), { conclusion: 'Sudah baik.\nPerbaiki no 3.', suggestion: 'Seragamkan opsi.\nTambah C4.' });
    assert.equal(composeGeneralComment('Hanya kesimpulan', '  '), 'Hanya kesimpulan');
    assert.deepEqual(splitGeneralComment('Catatan lama tanpa saran'), { conclusion: 'Catatan lama tanpa saran', suggestion: '' });
    assert.deepEqual(splitGeneralComment(composeGeneralComment('', 'Saran saja')), { conclusion: '', suggestion: 'Saran saja' });
    assert.deepEqual(splitGeneralComment(both.replace(/\n/g, '\r\n')), splitGeneralComment(both));
    assert.deepEqual(splitGeneralComment(null), { conclusion: '', suggestion: '' });
});

test('"Tandai sisanya Layak" marks only unreviewed items at once and keeps existing marks', async () => {
    const calls = [];
    const questions = [{ id: 'q1', question_text: 'First' }, { id: 'q2', question_text: 'Second' }, { id: 'q3', question_text: 'Third' }];
    const page = loadReviewPage(
        { validation: { id: 's', title: 'Test' }, myValidatorStatus: { validator_id: 'v', status: 'in_progress', general_comment: 'Baik.\n\nSaran umum untuk seluruh bank soal:\nSeragamkan opsi.' }, notes: [],
            items: [{ question_id: 'q2', validator_id: 'v', status: 'revision' }], questions },
        { setValidationItemsStatus: async (id, questionIds, status) => { calls.push([questionIds, status]);
            return { success: true, items: questionIds.map(question_id => ({ question_id, validator_id: 'v', status })) }; } },
    );
    let tree = await page.start();
    const bulk = page.nodes(tree).find(n => n.type === 'Button' && /Tandai 2 sisanya Layak/.test(page.text(n)));
    assert.ok(bulk, 'bulk button shown while items remain unreviewed');
    bulk.props.onClick();
    await new Promise(resolve => setTimeout(resolve, 0));
    tree = page.render();
    assert.deepEqual(calls, [[['q1', 'q3'], 'valid']]);
    assert.match(page.text(tree), /Selesaikan Validasi \(3\/3\)/);
    assert.equal(page.nodes(tree).some(n => n.type === 'Button' && /sisanya Layak/.test(page.text(n))), false);
    // Kesimpulan tersimpan dipisah kembali ke dua isian modal.
    page.nodes(tree).find(n => n.type === 'Button' && /Selesaikan Validasi/.test(page.text(n))).props.onClick();
    tree = page.render();
    const areas = page.nodes(tree).filter(n => n.type === 'textarea');
    assert.deepEqual(areas.map(n => n.props.value), ['Baik.', 'Seragamkan opsi.']);
});
