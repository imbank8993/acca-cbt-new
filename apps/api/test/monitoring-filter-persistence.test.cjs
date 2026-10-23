const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../web/lib/useMonitoringFilterState.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function mount(storage, pathname = '/dashboard/admin/monitoring', override) {
    const state = [], dependencies = [], pending = []; let cursor = 0;
    const React = {
        useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
        useEffect(callback, deps) { const i = cursor++; if (!dependencies[i] || deps.some((v, j) => v !== dependencies[i][j])) { dependencies[i] = deps; pending.push(callback); } },
    };
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', 'window', 'sessionStorage', code)(() => React, mod, mod.exports,
        { location: { pathname }, setTimeout: callback => { callback(); return 1; }, clearTimeout() {} }, storage);
    const render = () => { cursor = 0; const result = mod.exports.useMonitoringFilterState('selectedExamId', '', override); while (pending.length) pending.shift()(); return result; };
    render(); render();
    return render;
}
test('monitoring retains selected exam through remount and refresh, honors explicit links and separates roles', () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    const render = mount(storage);
    render()[1]('exam-A'); render();
    assert.equal(mount(storage)()[0], 'exam-A');
    assert.equal(mount(storage, '/dashboard/admin/monitoring', 'exam-B')()[0], 'exam-B');
    assert.equal(mount(storage, '/dashboard/guru/monitoring')()[0], '');
});
test('unavailable storage does not block monitoring', () => {
    const render = mount({ getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } });
    render()[1]('exam-A');
    assert.equal(render()[0], 'exam-A');
});
