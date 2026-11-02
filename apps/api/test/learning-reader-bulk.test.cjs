const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
function load(file, dependencies) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'crypto', code)(name => {
        if (!(name in dependencies)) throw Error('Unexpected dependency: ' + name);
        return dependencies[name];
    }, module, module.exports, webcrypto);
    return module.exports;
}

test('reader cache reuses requests and preserves patched completion on later navigation', async () => {
    let reads = 0;
    const cache = load('apps/web/lib/learning-reader-cache.ts', { './learning-api': {
        learningRequest: async id => { reads++; return { material: { id }, completed: false, materialUpdated: true }; },
    } });
    await Promise.all([cache.loadLearningDetail('one'), cache.loadLearningDetail('one')]);
    assert.equal(reads, 1);
    cache.patchLearningDetail('one', { completed: true, materialUpdated: false });
    assert.equal(cache.peekLearningDetail('one').completed, true);
    const revisited = await cache.loadLearningDetail('one');
    assert.equal(revisited.completed, true);
    assert.equal(revisited.materialUpdated, false);
    assert.equal(reads, 1);
});

test('reader cache retries failed reads and retains only a bounded number of HTML documents', async () => {
    let reads = 0;
    const cache = load('apps/web/lib/learning-reader-cache.ts', { './learning-api': {
        learningRequest: async id => { if (++reads === 1) throw Error('offline'); return { material: { id }, completed: false }; },
    } });
    await assert.rejects(cache.loadLearningDetail('first'), /offline/);
    await cache.loadLearningDetail('first');
    for (let index = 0; index < 9; index++) await cache.loadLearningDetail(String(index));
    assert.equal(cache.peekLearningDetail('first'), null);
    assert.equal(cache.peekLearningDetail('0'), null);
    assert.equal(cache.peekLearningDetail('8').material.id, '/8');
});

test('late completion responses cannot mark a different subchapter as complete', async () => {
    const file = path.join(root, 'apps/web/app/dashboard/learning/[id]/page.tsx');
    const source = fs.readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let mark;
    const visit = node => {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'mark') mark = node.initializer.getText(ast);
        ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.ok(mark);
    const module = { exports: {} };
    const code = ts.transpileModule(`module.exports = deps => { const { material, busy, completed, setBusy, setError, setDetail, learningRequest, patchLearningDetail } = deps; return (${mark})(); };`, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('module', code)(module);
    let finish, current = { material: { id: 'first', content_version: 1 }, completed: false };
    const patched = [];
    const saving = module.exports({ material: current.material, busy: false, completed: false,
        setBusy() {}, setError(message) { assert.equal(message, ''); },
        setDetail: update => { current = update(current); },
        learningRequest: () => new Promise(resolve => { finish = resolve; }),
        patchLearningDetail: (...args) => patched.push(args),
    });
    current = { material: { id: 'second', content_version: 1 }, completed: false };
    finish({ completed: true });
    await saving;
    assert.equal(current.material.id, 'second');
    assert.equal(current.completed, false);
    assert.deepEqual(patched, [['first', { completed: true, materialUpdated: false }]]);
});

test('returning to an already visible subchapter discards pending content from the abandoned navigation', () => {
    const file = path.join(root, 'apps/web/app/dashboard/learning/[id]/page.tsx');
    const source = fs.readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declarations = {};
    const visit = node => {
        if (ts.isVariableDeclaration(node) && ['surfaceKey', 'show', 'markReady'].includes(node.name.getText(ast))) declarations[node.name.getText(ast)] = node.initializer.getText(ast);
        ts.forEachChild(node, visit);
    };
    visit(ast);
    const code = `module.exports = (setSurfaces) => { const useCallback = fn => fn, setDetail = () => {}, surfaceKey = ${declarations.surfaceKey}; const show = ${declarations.show}; const markReady = ${declarations.markReady}; return { show, markReady }; };`;
    const module = { exports: {} };
    new Function('module', ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(module);
    const first = { key: 'first:1:1', ready: true, material: { id: 'first', content_version: 1, revision: 1 } };
    const abandoned = { key: 'second:1:1', ready: false, material: { id: 'second', content_version: 1, revision: 1 } };
    let surfaces = [first, abandoned];
    const reader = module.exports(update => { surfaces = update(surfaces); });
    reader.show({ material: first.material });
    assert.deepEqual(surfaces, [first]);
    reader.markReady(abandoned.key);
    assert.deepEqual(surfaces, [first]);
});

const bulkModule = dependencies => load('apps/web/lib/learning-bulk.ts', {
    './learning-converter': { convertLearningFile: async () => ({ format: 'html', html: '<p>Materi</p>', notes: [] }), ...dependencies?.converter },
    './learning-api': { learningRequest: async () => {}, deleteMaterial: async () => {}, ...dependencies?.api },
});

test('bulk files become naturally ordered subchapters with sensible titles and continued numbering', () => {
    const bulk = bulkModule();
    const files = ['02_Daerah_asal.html', '01_Definisi_fungsi.html'].map(name => new File(['<p>Materi</p>'], name));
    const numbered = bulk.planBulkDrafts(files, 1);
    assert.deepEqual(numbered.map(row => [row.order, row.title]), [[1, 'Definisi fungsi'], [2, 'Daerah asal']]);
    assert.deepEqual(bulk.planBulkDrafts(files, 3).map(row => row.order), [3, 4]);
    assert.deepEqual(bulk.parseSubchapterFileName('3.2 Daerah asal.html'), { number: 2, title: 'Daerah asal' });
});

test('bulk conversion failures create no drafts; failed uploads clean up only their new draft', async () => {
    const calls = [], removed = [];
    const api = { learningRequest: async (url, input) => { calls.push([url, input]); if (url) throw Error('upload failed'); return { material: { id: 'new-draft', revision: 0 } }; }, deleteMaterial: async id => removed.push(id) };
    const input = { file: new File(['content'], '01_Fungsi.html'), title: 'Fungsi', order: 1, grade: '10', subject: 'Matematika', topic: 'Fungsi', publish: false };
    const invalid = bulkModule({ api, converter: { convertLearningFile: async () => { throw Error('unreadable file'); } } });
    await assert.rejects(invalid.createSubchapterFromFile(input), /unreadable file/);
    assert.equal(calls.length, 0);
    await assert.rejects(bulkModule({ api }).createSubchapterFromFile(input), /upload failed/);
    assert.deepEqual(removed, ['new-draft']);
    assert.equal(calls.length, 2);
});

test('bulk uploads preserve the selected grade, subject, chapter, order and publication state', async () => {
    let uploaded;
    const bulk = bulkModule({ api: { learningRequest: async (url, input) => {
        if (!url) return { material: { id: 'new', revision: 3 } };
        uploaded = input.body;
        return { material: { id: 'new', status: uploaded.get('status') } };
    } } });
    const material = await bulk.createSubchapterFromFile({ file: new File(['content'], '02_Daerah.html'), title: 'Daerah Asal', order: 2, grade: '11', subject: 'Matematika', topic: 'Fungsi', publish: true });
    assert.equal(material.status, 'published');
    for (const [key, value] of Object.entries({ gradeLevel: '11', subject: 'Matematika', topic: 'Fungsi', subtopic: 'Daerah Asal', subtopicOrder: '2', status: 'published', revision: '3' })) assert.equal(uploaded.get(key), value);
});
