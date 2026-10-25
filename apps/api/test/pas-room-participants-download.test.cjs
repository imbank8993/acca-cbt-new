const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file, modules, globals = {}) {
    const source = fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => {
        assert.ok(name in modules, `Mock module available: ${name}`);
        return modules[name];
    }, mod, mod.exports, ...Object.values(globals));
    return mod.exports;
}

test('web download route forwards the requested period through the authenticated proxy', async () => {
    const calls = [], response = { status: 200 };
    const route = load('app/api/pas/periods/[periodId]/room-participants/route.ts', {
        '@/lib/nest-proxy': { proxyGet: (request, target) => { calls.push({ request, target }); return response; } },
    });
    const request = { headers: { cookie: 'session-fixture' } };
    assert.equal(await route.GET(request, { params: Promise.resolve({ periodId: 'period/with space' }) }), response);
    assert.deepEqual(calls, [{ request, target: '/pas/periods/period%2Fwith%20space/room-participants' }]);
});

function harness() {
    const state = [], downloads = [], requests = [];
    let cursor = 0, fail = false;
    const rooms = [{ id: 'r1', name: 'Ruang A', students: [{ full_name: 'A' }] }, { id: 'r2', name: 'Ruang B', students: [{ full_name: 'B' }] }];
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
        useState(initial) {
            const index = cursor++;
            if (!(index in state)) state[index] = initial;
            return [state[index], value => { state[index] = value; }];
        },
        useRef(initial) {
            const index = cursor++;
            if (!(index in state)) state[index] = { current: initial };
            return state[index];
        },
    };
    const Component = load('app/components/pas/RoomParticipantsDownload.tsx', {
        react: React,
        'lucide-react': { Download: 'download-icon' },
        '@/app/components/ui/button': { Button: 'button' },
        '@/app/components/ui/inlineselect': { InlineSelect: 'select' },
        '@/lib/api/pas': { listPASRoomParticipants: async id => { requests.push(id); if (fail) throw Error('Connection failed'); return rooms; } },
        '@/lib/pas/room-participants-pdf': { downloadRoomParticipantsPdf: async (period, chosen) => { downloads.push({ period, chosen }); } },
    }, { React }).RoomParticipantsDownload;
    return {
        render: () => { cursor = 0; return Component({ period: { id: 'period', name: 'ASAS' }, rooms }); },
        downloads, requests, fail: value => { fail = value; },
    };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.children)];
const control = (tree, type) => nodes(tree).find(node => node.type === type);
const flush = () => new Promise(resolve => setImmediate(resolve));

test('administration download supports all rooms and a specific room, preventing duplicate requests', async () => {
    const h = harness();
    const button = control(h.render(), 'button');
    button.props.onClick(); button.props.onClick();
    assert.equal(control(h.render(), 'button').props.disabled, true);
    await flush();
    assert.deepEqual(h.requests, ['period']);
    assert.deepEqual(h.downloads[0].chosen.map(room => room.id), ['r1', 'r2']);
    control(h.render(), 'select').props.onChange('r2');
    control(h.render(), 'button').props.onClick(); await flush();
    assert.deepEqual(h.downloads[1].chosen.map(room => room.id), ['r2']);
    assert.equal(control(h.render(), 'button').props.disabled, false);
});

test('failed download shows its error, permits retry and never generates an incomplete PDF', async () => {
    const h = harness(); h.fail(true);
    control(h.render(), 'button').props.onClick(); await flush();
    assert.equal(h.downloads.length, 0);
    assert.ok(nodes(h.render()).find(node => node.props.role === 'alert'));
    assert.equal(control(h.render(), 'button').props.disabled, false);
    h.fail(false);
    control(h.render(), 'button').props.onClick(); await flush();
    assert.equal(h.downloads.length, 1);
    assert.ok(!nodes(h.render()).find(node => node.props.role === 'alert'));
});
