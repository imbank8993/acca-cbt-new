const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

test('chair selection fills NIP, clears missing NIP, and allows manual names', async () => {
    const state = []; let cursor = 0; let mounted = false;
    const React = {
        createElement: (type, props, ...children) => ({ type, props, children }),
        useState(value) {
            const index = cursor++;
            if (!(index in state)) state[index] = value;
            return [state[index], next => { state[index] = next; }];
        },
        useEffect(callback) { if (!mounted) { mounted = true; callback(); } },
    };
    const staff = [
        { id: 'a', name: 'Ani', nip: '123', roles: ['Guru'] },
        { id: 'b', name: 'Budi', nip: null, roles: ['Guru'] },
        { id: 'c', name: 'Pengawas', nip: '456', roles: ['Pengawas'] },
    ];
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/pas/CommitteeChairNameInput.tsx'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', 'React', code)(name => {
        if (name === 'react') return React;
        if (name.includes('InlineSelect')) return { InlineSelect: 'select' };
        return { listTeachersAndInvigilators: async () => staff };
    }, mod, mod.exports, React);
    let value = 'Manual'; let nip = '999';
    const render = () => { cursor = 0; return mod.exports.CommitteeChairNameInput({ value, nip, onChange: (n, p) => { value = n; nip = p; } }); };
    render();
    await new Promise(resolve => setImmediate(resolve));
    let tree = render();
    assert.equal(tree.children[0].props.options.length, 3);
    tree.children[0].props.onChange('a');
    assert.deepEqual([value, nip], ['Ani', '123']);
    tree = render();
    tree.children[1].props.onChange({ target: { value: 'Nama manual' } });
    assert.deepEqual([value, nip], ['Nama manual', '']);
    tree.children[0].props.onChange('b');
    assert.deepEqual([value, nip], ['Budi', '']);
});
