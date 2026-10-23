const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { PasRoomsService } = require('../src/pas/pas-rooms.service.ts');

test('master room catalog returns active rooms with string IDs and capacity without modifying master', async () => {
    const db = fixtureDb({ master_ruangan: [
        { id: 12, nama: 'Lab', kode: 'L1', lokasi: 'Lantai 2', kapasitas: 24, aktif: true },
        { id: 13, nama: 'Tutup', aktif: false },
    ] });
    const service = new PasRoomsService(db, { assertOrgStaff: async (_, school) => assert.equal(school, 'school') });
    assert.deepEqual(await service.listMasterRooms({ id: 'staff' }, 'school'), [
        { id: '12', name: 'Lab', code: 'L1', location: 'Lantai 2', capacity: 24 },
    ]);
    assert.equal(db.writes.length, 0);
});

test('master room catalog checks staff scope before reading master', async () => {
    const db = fixtureDb();
    const service = new PasRoomsService(db, { assertOrgStaff: async () => { throw new Error('Forbidden'); } });
    await assert.rejects(service.listMasterRooms({ id: 'student' }, 'school'), /Forbidden/);
    assert.equal(db.queries.length, 0);
});

test('master catalog failure is distinguished from an empty catalog and manual room creation still works', async () => {
    const db = fixtureDb({ cbt_pas_periods: [{ id: 'period', is_locked: false }] }, ['master_ruangan']);
    const service = new PasRoomsService(db, { assertOrgStaff: async () => {}, assertProktorByRecord: async () => {} });
    await assert.rejects(service.listMasterRooms({ id: 'staff' }, 'school'), /manual/);
    await service.createRoom({ id: 'staff' }, 'period', { name: 'Ruang tambahan', capacity: 18, clientRequestId: 'request-manual' });
    assert.equal(db.tables.cbt_pas_rooms[0].name, 'Ruang tambahan');
    assert.equal(db.tables.cbt_pas_rooms[0].capacity, 18);
});

test('browser master-room route forwards the authenticated request to the PAS catalog', async () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/api/pas/master-rooms/route.ts'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const mod = { exports: {} }; const request = {}; const response = { rooms: [] }; let called = false;
    new Function('require', 'module', 'exports', code)(name => {
        assert.equal(name, '@/lib/nest-proxy');
        return { proxyGet: (req, target) => { assert.equal(req, request); assert.equal(target, '/pas/master-rooms'); called = true; return response; } };
    }, mod, mod.exports);
    assert.equal(await mod.exports.GET(request), response);
    assert.equal(called, true);
});

test('single room field offers master suggestions, copies capacity and still accepts manual names', async () => {
    const state = []; const effects = []; let cursor = 0; let name; let capacity;
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
        useId: () => 'room-list',
        useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
        useEffect: fn => effects.push(fn),
    };
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/PASRoomInput.tsx'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', 'React', code)(name => name === 'react' ? React : {
        listMasterRooms: async () => [{ id: 'master-1', name: 'Lab Komputer', capacity: 24 }, { id: 'master-2', name: 'Ruang A', capacity: 30 }],
    }, mod, mod.exports, React);
    const props = { value: '', onChange: value => { name = value; }, onCapacityChange: value => { capacity = value; }, existingRooms: [{ id: 'period-1', name: 'Ruang A', capacity: 20 }] };
    const render = () => { cursor = 0; return mod.exports.PASRoomInput(props); };
    const nodes = root => !root || typeof root !== 'object' ? [] : Array.isArray(root) ? root.flatMap(nodes) : [root, ...nodes(root.children)];
    render(); effects[0](); await new Promise(resolve => setImmediate(resolve));
    const closed = render();
    nodes(closed).find(n => n.type === 'input').props.onFocus();
    const tree = render();
    const listbox = nodes(tree).find(n => n.props.role === 'listbox');
    assert.doesNotMatch(listbox.props.className || '', /\babsolute\b/);
    const options = nodes(tree).filter(n => n.props.role === 'option');
    assert.deepEqual(options.map(n => nodes(n).find(child => child.type === 'span').children[0]), ['Ruang A', 'Lab Komputer']);
    assert.equal(nodes(tree).filter(n => n.type === 'input').length, 1);
    const input = nodes(tree).find(n => n.type === 'input');
    assert.equal(input.props['aria-expanded'], true);
    options[1].props.onClick();
    assert.equal(name, 'Lab Komputer'); assert.equal(capacity, 24);
    input.props.onChange({ target: { value: 'Lab Komputer' } });
    assert.equal(name, 'Lab Komputer'); assert.equal(capacity, 24);
    input.props.onChange({ target: { value: 'Ruang khusus' } });
    assert.equal(name, 'Ruang khusus'); assert.equal(capacity, 24);
    for (const role of ['admin', 'proktor']) {
        const modal = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/pas/RoomManagementPanel.tsx'), 'utf8');
        assert.match(modal, /title="Tambah Ruang"[\s\S]*?size="md"[\s\S]*?<div className="pas-room-create space-y-4">[\s\S]*?<ModalFooter>/);
    }
});

test('room-list failures are reported instead of appearing as an empty catalog', async () => {
    const db = fixtureDb({}, ['cbt_pas_rooms']);
    const service = new PasRoomsService(db, { assertStaffByRecord: async () => {} });
    await assert.rejects(service.listRooms({ id: 'staff' }, 'period'), /Daftar ruang ujian belum dapat dimuat/);
});

test('room loading explicitly joins students by their room FK despite the additional composite FK', async () => {
    const { RelationRegistry } = require('../src/prisma/relation-registry.ts');
    const { parseSelect, compileSelect } = require('../src/prisma/postgrest-select.ts');
    const db = fixtureDb();
    const service = new PasRoomsService(db, { assertStaffByRecord: async () => {} });
    await service.listRooms({ id: 'staff' }, 'period');
    const select = db.queries.find(q => q.table === 'cbt_pas_rooms').calls.find(call => call[0] === 'select')[1];
    const registry = new RelationRegistry({});
    const edge = (srcTable, srcColumn, tgtTable, tgtColumn, constraintName) => ({ srcTable, srcColumn, tgtTable, tgtColumn, constraintName });
    registry.edges = [
        edge('cbt_pas_room_students', 'pas_room_id', 'cbt_pas_rooms', 'id', 'cbt_pas_room_students_pas_room_id_fkey'),
        ...['pas_room_id', 'pas_period_id'].flatMap(src => ['id', 'pas_period_id'].map(tgt =>
            edge('cbt_pas_room_students', src, 'cbt_pas_rooms', tgt, 'cbt_pas_room_students_room_period_fkey'))),
        edge('cbt_pas_room_invigilators', 'pas_room_id', 'cbt_pas_rooms', 'id', 'room-fk'),
        edge('cbt_pas_room_invigilators', 'user_id', 'cbt_profiles', 'id', 'inv-user-fk'),
        edge('cbt_pas_room_students', 'user_id', 'cbt_profiles', 'id', 'student-user-fk'),
    ];
    const result = compileSelect(parseSelect(select), { table: 'cbt_pas_rooms', sqlAlias: 'rooms', registry,
        push: () => '$1', filters: [], counter: { value: 0 } });
    const sql = result.expressions.join(' ');
    assert.match(sql, /"r\d+"\."pas_room_id" = "rooms"\."id"/);
    assert.doesNotMatch(sql, /"r\d+"\."pas_period_id" = "rooms"\."id"/);
});
