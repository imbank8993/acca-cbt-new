const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function chairInput(loadTeachers = async () => [
    { id: 'a', name: 'Ani', nip: '123' },
    { id: 'b', name: 'Budi', nip: null },
]) {
    const state = []; let cursor = 0; let mounted = false;
    const React = {
        createElement: (type, props, ...children) => ({ type, props, children }),
        useState(value) {
            const index = cursor++;
            if (!(index in state)) state[index] = value;
            return [state[index], next => { state[index] = next; }];
        },
        useEffect(callback) { if (!mounted) { mounted = true; callback(); } },
        useId: () => 'teacher-suggestions',
    };
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/pas/CommitteeChairNameInput.tsx'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', 'React', code)(name => {
        if (name === 'react') return React;
        return { listCommitteeTeachers: loadTeachers };
    }, mod, mod.exports, React);
    let value = 'Manual'; let nip = '999';
    const render = () => { cursor = 0; return mod.exports.CommitteeChairNameInput({ value, nip, required: true, onChange: (n, p) => { value = n; nip = p; } }); };
    const nodes = root => !root || typeof root !== 'object' ? [] : Array.isArray(root) ? root.flatMap(nodes) : [root, ...nodes(root.children)];
    return { render, nodes, values: () => [value, nip] };
}

test('one searchable name field selects teachers, fills NIP, and accepts manual names', async () => {
    const host = chairInput();
    let tree = host.render();
    let input = host.nodes(tree).find(node => node.type === 'input');
    assert.ok(!input.props.disabled, 'Manual typing is available while loading');
    input.props.onChange({ target: { value: 'Manual during loading' } });
    assert.deepEqual(host.values(), ['Manual during loading', '999']);
    await new Promise(resolve => setImmediate(resolve));
    tree = host.render();
    assert.equal(host.nodes(tree).filter(node => node.type === 'input').length, 1);
    assert.equal(host.nodes(tree).filter(node => node.type === 'select').length, 0);
    assert.equal(host.nodes(tree).filter(node => node.type === 'option').length, 2);
    input = host.nodes(tree).find(node => node.type === 'input');
    assert.equal(input.props.list, 'teacher-suggestions');
    assert.equal(input.props.required, true);
    input.props.onChange({ target: { value: 'Ani' } });
    assert.deepEqual(host.values(), ['Ani', '123']);
    tree = host.render();
    host.nodes(tree).find(node => node.type === 'input').props.onChange({ target: { value: 'Nama manual' } });
    assert.deepEqual(host.values(), ['Nama manual', '']);
    host.nodes(tree).find(node => node.type === 'input').props.onChange({ target: { value: 'Budi' } });
    assert.deepEqual(host.values(), ['Budi', '']);
});

test('teacher catalog errors leave manual entry available and explain the failure', async () => {
    const host = chairInput(async () => { throw new Error('offline'); });
    host.render();
    await new Promise(resolve => setImmediate(resolve));
    const tree = host.render();
    const input = host.nodes(tree).find(node => node.type === 'input');
    assert.ok(!input.props.disabled);
    input.props.onChange({ target: { value: 'Nama manual' } });
    assert.deepEqual(host.values(), ['Nama manual', '999']);
    assert.match(JSON.stringify(tree), /Master guru belum dapat dimuat/);
});

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { PasService } = require('../src/pas/pas.service.ts');

test('committee catalog reads all active master teachers even without CBT accounts', async () => {
    const db = fixtureDb({ master_guru: [
        { id: 1, nama_lengkap: 'Guru tanpa akun CBT', nip: '123', jenis_pegawai: 'GURU', aktif: true },
        { id: 2, nama_lengkap: 'Guru data lama', nip: null, jenis_pegawai: null, aktif: null },
        { id: 3, nama_lengkap: 'Tendik', jenis_pegawai: 'TENDIK', aktif: true },
        { id: 4, nama_lengkap: 'Guru nonaktif', jenis_pegawai: 'GURU', aktif: false },
    ] });
    const service = new PasService(db, { assertProktor: async (_, org) => assert.equal(org, 'school') });
    const teachers = await service.listCommitteeTeachers({ id: 'proctor' }, 'school');
    assert.deepEqual(new Set(teachers.map(teacher => teacher.name)), new Set(['Guru tanpa akun CBT', 'Guru data lama']));
    assert.deepEqual(teachers.find(teacher => teacher.id === '1'), { id: '1', name: 'Guru tanpa akun CBT', nip: '123' });
    assert.equal(db.writes.length, 0);
    assert.ok(db.queries.every(query => query.table === 'master_guru'));
});

test('committee catalog checks access before reading and distinguishes database failure', async () => {
    const db = fixtureDb({}, ['master_guru']);
    const denied = new PasService(db, { assertProktor: async () => { throw new Error('Forbidden'); } });
    await assert.rejects(denied.listCommitteeTeachers({ id: 'student' }, 'school'), /Forbidden/);
    assert.equal(db.queries.length, 0);
    const allowed = new PasService(db, { assertProktor: async () => {} });
    await assert.rejects(allowed.listCommitteeTeachers({ id: 'proctor' }, 'school'), /manual/);
});

test('committee teacher browser route forwards the authenticated request', async () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/api/pas/committee-teachers/route.ts'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const mod = { exports: {} }; const request = {}; const response = { teachers: [] };
    new Function('require', 'module', 'exports', code)(() => ({
        proxyGet: (req, target) => { assert.equal(req, request); assert.equal(target, '/pas/committee-teachers'); return response; },
    }), mod, mod.exports);
    assert.equal(await mod.exports.GET(request), response);
});
