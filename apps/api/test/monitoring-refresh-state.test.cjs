const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function callbacks(role) {
    const source = fs.readFileSync(path.resolve(__dirname, `../../web/app/dashboard/${role}/monitoring/page.tsx`), 'utf8');
    const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let load, selection;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'loadExamData') load = node.initializer.arguments[0];
        if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
            && node.arguments[1]?.getText(ast).includes('loadExamData, selectedExamId')
            && node.arguments[0].getText(ast).includes('setAttempts(')) selection = node.arguments[0];
        ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(load && selection, `${role}: load and selection lifecycle found`);
    const bind = (node, env) => {
        const code = ts.transpileModule(`(${node.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.trim().replace(/;$/, '');
        return new Function('env', `with (env) { return ${code}; }`)(env);
    };
    return env => ({ load: bind(load, env), select: bind(selection, env) });
}

function fixture(role) {
    const pending = [];
    const state = { refreshing: false, attempts: [], error: null };
    const env = {
        activeTab: 'live', selectedExamId: 'old',
        examRequestGenerationRef: { current: 0 }, loadingExamIdsRef: { current: new Map() }, lastRequestedExamIdRef: { current: '' },
        setIsRefreshing: value => { state.refreshing = value; },
        setAttempts: value => { state.attempts = value; }, setLoadError: value => { state.error = value; },
        setAnalysis() {}, setDetailedAnalysis() {}, setTopicAnalysis() {}, setIrtCalibration() {}, setAnalysisPage() {},
        formatStudentName: name => name, buildItemAnalysis: () => [], console: { error() {} },
        window: { setTimeout(callback) { callback(); return 1; }, clearTimeout() {} },
    };
    const request = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
    env.getExamAttemptsAction = request;
    env.getExamAttemptsResult = () => request().then(attempts => ({ success: true, attempts }));
    const bound = callbacks(role)(env);
    env.loadExamData = bound.load;
    return { ...bound, env, state, pending };
}

for (const role of ['admin', 'proktor', 'guru']) {
    test(`${role}: selecting a folder clears the old spinner and ignores the old response`, async () => {
        const f = fixture(role);
        const request = f.load('old');
        assert.equal(f.state.refreshing, true);
        f.env.selectedExamId = ''; // FolderExamMonitor now owns the selected folder's data.
        f.select();
        assert.equal(f.state.refreshing, false, 'folder selection must release the parent refresh state');
        f.pending[0].resolve([{ id: 'stale', profiles: { full_name: 'Old participant' } }]);
        await request;
        assert.deepEqual(f.state.attempts, [], 'old response must not overwrite the new view');
    });
    test(`${role}: a background request cannot inherit a spinner from an obsolete foreground request`, async () => {
        const f = fixture(role);
        const old = f.load('old');
        const current = f.load('new', true);
        f.pending[1].resolve([]);
        await current;
        assert.equal(f.state.refreshing, false);
        f.pending[0].resolve([]);
        await old;
        assert.equal(f.state.refreshing, false);
    });
    test(`${role}: polling skips an in-flight manual refresh without changing its loading state`, async () => {
        const f = fixture(role);
        const request = f.load('old');
        await f.load('old', true);
        assert.equal(f.pending.length, 1);
        assert.equal(f.state.refreshing, true);
        f.pending[0].resolve([]);
        await request;
        assert.equal(f.state.refreshing, false);
    });
    test(`${role}: an old response cannot stop a newer manual refresh, and failures release the spinner`, async () => {
        const f = fixture(role);
        const old = f.load('old');
        const current = f.load('new');
        f.pending[0].resolve([]);
        await old;
        assert.equal(f.state.refreshing, true);
        f.pending[1].reject(new Error('network failure'));
        await current;
        assert.equal(f.state.refreshing, false);
        assert.equal(f.state.error, 'network failure');
    });
}
