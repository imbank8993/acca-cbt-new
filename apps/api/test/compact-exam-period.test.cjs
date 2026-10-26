const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const web = path.resolve(__dirname, '../../web');
const nodes = root => !root || typeof root !== 'object' ? [] : Array.isArray(root) ? root.flatMap(nodes) : [root, ...nodes(root.children)];
const text = root => root == null || typeof root === 'boolean' ? '' : typeof root !== 'object' ? String(root) : Array.isArray(root) ? root.map(text).join('') : text(root.children);
const find = (tree, predicate) => {
    const result = nodes(tree).find(predicate);
    assert.ok(result, 'Expected rendered control is available');
    return result;
};
const button = (tree, label) => find(tree, node => node.type === 'button' && text(node) === label);

function harness() {
    const state = [];
    let cursor = 0;
    const React = {
        createElement(type, props, ...children) {
            if (typeof type === 'function') return type({ ...props, children });
            if (props?.ref && typeof props.ref === 'object') {
                props.ref.current = { getBoundingClientRect: () => ({ left: 100, right: 180, top: 80, bottom: 120 }), focus() {} };
            }
            return { type, props: props || {}, children };
        },
        useState(initial) {
            const index = cursor++;
            if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
            return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
        },
        useRef(initial) {
            const index = cursor++;
            if (!(index in state)) state[index] = { current: initial };
            return state[index];
        },
        useId() { const index = cursor++; return `test-control-${index}`; },
        useEffect() {},
    };
    // Komponen bersama (Button, FilterToolbar, Modal) dirender sebagai elemen dasar agar mudah diperiksa.
    const h = React.createElement;
    const ui = {
        button: { Button: ({ children, leftIcon, ...props }) => h('button', props, ...[leftIcon, children].filter(item => item != null)) },
        filters: {
            FilterToolbar: ({ children }) => h('div', {}, children),
            FilterActions: ({ children }) => h('div', {}, children),
            FilterSearch: ({ value, onChange, placeholder }) => h('input', { type: 'search', value, placeholder, onChange: event => onChange(event.target.value) }),
            FilterSelect: ({ label, value, onChange, options = [] }) => h('select', { 'aria-label': label, value, onChange: event => onChange(event.target.value) },
                ...options.map(option => h('option', { value: option.value }, option.label))),
        },
        modal: {
            Modal: ({ open, children }) => open === false ? null : h('dialog', {}, children),
            ModalBody: ({ children }) => h('div', {}, children),
            ModalFooter: ({ children }) => h('div', {}, children),
        },
    };
    const load = (relativePath, modules = {}) => {
        const source = fs.readFileSync(path.join(web, relativePath), 'utf8');
        const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
        const mod = { exports: {} };
        new Function('require', 'module', 'exports', 'React', 'document', 'window', code)(name => {
            if (name === 'react') return React;
            if (name.endsWith('.css')) return {};
            if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => `icon-${String(key)}` });
            assert.ok(name in modules, `Module available: ${name}`);
            return modules[name];
        }, mod, mod.exports, React, { body: {} }, { innerHeight: 800, innerWidth: 1200 });
        return mod.exports;
    };
    const status = load('app/components/PASScheduleStatus.tsx', { './ui/modal': {}, './ui/button': {} });
    const room = load('app/components/PASScheduleRooms.tsx', {
        './ui/button': ui.button,
        '@/lib/api/pas': { getRoomSessionInvigilators: (value, session) => session ? (value?.pas_room_invigilators || []).filter(person => person.session_id === session) : [] },
    });
    const examTypes = load('lib/exam-types.ts');
    const workspace = load('app/components/pas/CompactExamPeriodWorkspace.tsx', {
        '@/app/components/ui/button': ui.button,
        '@/app/components/ui/filtertoolbar': ui.filters,
        '@/app/components/ui/modal': ui.modal,
        '@/lib/school-time': { formatSchoolDate: value => value.split('T')[0], getSchoolTimeZoneLabel: () => 'WITA' },
        '@/lib/exam-types': examTypes,
        '../PASScheduleStatus': status,
        '../PASScheduleRooms': room,
        '../PASScheduleActions': { PASScheduleActions: props => React.createElement('schedule-actions', props) },
    });
    const actions = load('app/components/PASScheduleActions.tsx', { 'react-dom': { createPortal: value => value }, './ui/button': ui.button });
    return { workspace, actions, render(component, props) { cursor = 0; return component(props); } };
}

const schedule = patch => ({
    id: 'ready', pas_period_id: 'period', bank_id: 'bank', class_id: 'class', exam_id: 'exam', session_id: 'morning',
    scheduled_date: '2026-10-19', scheduled_time: '08:00:00', window_end_time: '10:00:00', duration_minutes: 90,
    room: 'Label bebas', status: 'scheduled', is_activated: false, readiness: { ready: true, issues: [] },
    allocated_room_ids: ['lab'], classes: { id: 'class', name: 'X 1' }, question_banks: { title: 'Matematika' }, ...patch,
});
function props(schedules, patch = {}) {
    return {
        period: { id: 'period', name: 'ASAS', type: 'pas', is_locked: false, pas_class_schedules: schedules },
        classes: [{ id: 'class', name: 'X 1' }],
        sessions: [{ id: 'morning', name: 'Pagi', start_time: '08:00:00', end_time: '10:00:00' }],
        rooms: [{ id: 'lab', name: 'Laboratorium', pas_room_invigilators: [
            { session_id: 'morning', profiles: { full_name: 'Bu Sari' } },
            { session_id: 'afternoon', profiles: { full_name: 'Pengawas sore' } },
        ] }],
        timeZone: 'Asia/Makassar', today: '2026-10-19', bankTitle: (_id, value) => value.question_banks?.title || 'Bank tidak tersedia',
        busy: false, onActivation() {}, onDelete() {}, onManageRooms() {}, monitoringBasePath: '/dashboard/admin/monitoring',
        onAddSchedule() {}, onBulkSchedule() {}, ...patch,
    };
}

test('unknown readiness and activation never become eligible because an exam exists', () => {
    const h = harness();
    const value = props([schedule({ id: 'unknown', is_activated: null, readiness: undefined }), schedule({ id: 'incomplete', readiness: { ready: true, issues: ['Pengawas belum ada'] } }), schedule({})]);
    let tree = h.render(h.workspace.CompactExamPeriodSchedules, value);
    for (const [id, active, canActivate] of [['unknown', null, false], ['incomplete', false, false], ['ready', false, true]]) {
        const row = find(tree, node => node.type === 'tr' && node.props.key === id);
        const action = find(row, node => node.type === 'schedule-actions');
        assert.deepEqual([action.props.active, action.props.canActivate], [active, canActivate]);
    }
    assert.match(text(tree), /Belum diperiksa/);
    const row = find(tree, node => node.type === 'tr' && node.props.key === 'unknown');
    button(row, 'Detail').props.onClick();
    tree = h.render(h.workspace.CompactExamPeriodSchedules, value);
    assert.match(text(find(tree, node => node.type === 'dialog')), /Kelengkapan belum dapat dipastikan/);
});

test('locked schedules can still be deactivated while activation and deletion remain unavailable', () => {
    const h = harness();
    const calls = [];
    const value = props([schedule({ is_activated: true, readiness: { ready: false, issues: ['Pengawas belum ada'] } })], { onActivation: (...args) => calls.push(args) });
    value.period.is_locked = true;
    let tree = h.render(h.workspace.CompactExamPeriodSchedules, value);
    const action = find(tree, node => node.type === 'schedule-actions');
    assert.equal(action.props.canActivate, false);
    assert.equal(action.props.canDelete, false);
    action.props.onActivate();
    assert.deepEqual(calls, [[['ready'], false]]);
    find(tree, node => node.type === 'input' && node.props['aria-label'] === 'Pilih semua jadwal di halaman ini').props.onChange();
    tree = h.render(h.workspace.CompactExamPeriodSchedules, value);
    const selection = find(tree, node => node.props['aria-label'] === 'Tindakan jadwal terpilih');
    assert.equal(button(selection, 'Nonaktifkan (1)').props.disabled, false);
    assert.equal(nodes(selection).some(node => node.type === 'button' && text(node).startsWith('Aktifkan')), false);
    button(selection, 'Nonaktifkan (1)').props.onClick();
    assert.deepEqual(calls.at(-1), [['ready'], false]);
});

test('compact actions menu preserves locked deactivation and disables unknown activation', () => {
    const h = harness();
    let calls = 0;
    let value = { compact: true, active: true, busy: false, canActivate: false, canDelete: false, onActivate: () => { calls++; }, onDelete() {} };
    let tree = h.render(h.actions.PASScheduleActions, value);
    find(tree, node => node.type === 'button' && node.props['aria-label'] === 'Aksi lainnya').props.onClick();
    tree = h.render(h.actions.PASScheduleActions, value);
    assert.equal(button(tree, 'Nonaktifkan').props.disabled, false);
    button(tree, 'Nonaktifkan').props.onClick();
    assert.equal(calls, 1);
    value = { ...value, active: null };
    tree = h.render(h.actions.PASScheduleActions, value);
    find(tree, node => node.type === 'button' && node.props['aria-label'] === 'Aksi lainnya').props.onClick();
    tree = h.render(h.actions.PASScheduleActions, value);
    assert.equal(button(tree, 'Aktifkan').props.disabled, true);
});

test('changing every schedule filter clears selections and resetting restores the full list', () => {
    for (const filter of ['search', 'Tanggal', 'Kelas', 'Kesiapan', 'Akses siswa']) {
        const h = harness();
        const value = props([schedule({}), schedule({ id: 'second', is_activated: true })]);
        let tree = h.render(h.workspace.CompactExamPeriodSchedules, value);
        find(tree, node => node.type === 'input' && node.props['aria-label'] === 'Pilih semua jadwal di halaman ini').props.onChange();
        tree = h.render(h.workspace.CompactExamPeriodSchedules, value);
        assert.match(text(tree), /2 jadwal dipilih/);
        const control = filter === 'search' ? find(tree, node => node.type === 'input' && node.props.type === 'search') : find(tree, node => node.type === 'select' && node.props['aria-label'] === filter);
        control.props.onChange({ target: { value: { search: 'tidak cocok', Tanggal: '2026-10-20', Kelas: 'missing', Kesiapan: 'pending', 'Akses siswa': 'unknown' }[filter] } });
        tree = h.render(h.workspace.CompactExamPeriodSchedules, value);
        assert.equal(nodes(tree).some(node => node.props['aria-label'] === 'Tindakan jadwal terpilih'), false, filter);
        button(tree, 'Hapus filter').props.onClick();
        tree = h.render(h.workspace.CompactExamPeriodSchedules, value);
        assert.match(text(tree), /1–2 dari 2 jadwal/);
    }
});

test('selection applies to the current page and bulk actions receive only eligible rows', () => {
    const h = harness();
    const calls = [];
    const schedules = Array.from({ length: 26 }, (_, index) => schedule({ id: String(index).padStart(2, '0'), is_activated: index === 0 ? true : index === 1 ? null : false, readiness: { ready: index !== 2, issues: index === 2 ? ['Belum lengkap'] : [] } }));
    const value = props(schedules, { onActivation: (...args) => calls.push(args) });
    let tree = h.render(h.workspace.CompactExamPeriodSchedules, value);
    find(tree, node => node.type === 'input' && node.props['aria-label'] === 'Pilih semua jadwal di halaman ini').props.onChange();
    tree = h.render(h.workspace.CompactExamPeriodSchedules, value);
    button(tree, 'Aktifkan (22)').props.onClick();
    assert.deepEqual(calls[0], [schedules.slice(3, 25).map(value => value.id), true]);
    button(tree, 'Nonaktifkan (1)').props.onClick();
    assert.deepEqual(calls[1], [['00'], false]);
    assert.ok(!calls.flat(2).includes('25'), 'Unselected next-page schedule is excluded');
});

test('activation clears selected schedules only after successful completion and retains canceled selections', async () => {
    for (const completed of [false, true]) {
        const h = harness();
        let settle;
        const completion = new Promise(resolve => { settle = resolve; });
        const value = props([schedule({})], { onActivation: () => completion });
        let tree = h.render(h.workspace.CompactExamPeriodSchedules, value);
        find(tree, node => node.type === 'input' && node.props['aria-label'] === 'Pilih semua jadwal di halaman ini').props.onChange();
        tree = h.render(h.workspace.CompactExamPeriodSchedules, value);
        button(tree, 'Aktifkan (1)').props.onClick();
        tree = h.render(h.workspace.CompactExamPeriodSchedules, value);
        assert.match(text(tree), /1 jadwal dipilih/, 'Selection remains while awaiting confirmation and completion');
        settle(completed);
        await completion;
        tree = h.render(h.workspace.CompactExamPeriodSchedules, value);
        const hasSelection = nodes(tree).some(node => node.props['aria-label'] === 'Tindakan jadwal terpilih');
        assert.equal(hasSelection, !completed, completed ? 'Success clears selection' : 'Cancellation/failure preserves selection');
        const selectAll = find(tree, node => node.type === 'input' && node.props['aria-label'] === 'Pilih semua jadwal di halaman ini');
        assert.equal(selectAll.props.checked, !completed);
    }
});

test('detail shows actual room and current session supervisors from the latest server data', () => {
    const h = harness();
    const value = props([schedule({})]);
    let tree = h.render(h.workspace.CompactExamPeriodSchedules, value);
    const row = find(tree, node => node.type === 'tr' && node.props.key === 'ready');
    assert.match(text(row), /Laboratorium/);
    assert.doesNotMatch(text(row), /Label bebas|Bu Sari|Pengawas sore/);
    button(row, 'Detail').props.onClick();
    tree = h.render(h.workspace.CompactExamPeriodSchedules, value);
    let dialog = find(tree, node => node.type === 'dialog');
    assert.match(text(dialog), /LaboratoriumBu Sari/);
    assert.doesNotMatch(text(dialog), /Label bebas|Pengawas sore/);
    assert.equal(find(dialog, node => node.type === 'a').props.href, '/dashboard/admin/monitoring?exam=exam');
    value.rooms = [{ id: 'lab', name: 'Ruang terbaru', pas_room_invigilators: [{ session_id: 'morning', profiles: { full_name: 'Pak Budi' } }] }];
    value.period = { ...value.period, pas_class_schedules: [schedule({ duration_minutes: 75, is_activated: true })] };
    tree = h.render(h.workspace.CompactExamPeriodSchedules, value);
    dialog = find(tree, node => node.type === 'dialog');
    assert.match(text(dialog), /Ruang terbaruPak Budi/);
    assert.match(text(dialog), /75 menit/);
    assert.doesNotMatch(text(dialog), /Bu Sari|Laboratorium/);
    value.period = { ...value.period, pas_class_schedules: [] };
    tree = h.render(h.workspace.CompactExamPeriodSchedules, value);
    assert.match(text(find(tree, node => node.type === 'dialog')), /Jadwal tidak lagi tersedia/);
});

test('room column names every room with the class head count instead of "N ruang"', () => {
    const h = harness();
    const rooms = ['a', 'b', 'c', 'd'].map(id => ({ id, name: `Ruang ${id.toUpperCase()}`, pas_room_invigilators: [] }));
    const split = schedule({ allocated_room_ids: ['a', 'b'], allocated_room_counts: { a: 8, b: 12 }, unallocated_student_count: 3 });
    let row = find(h.render(h.workspace.CompactExamPeriodSchedules, props([split], { rooms })), node => node.type === 'tr' && node.props.key === 'ready');
    assert.match(text(row), /Ruang B\(12\)Ruang A\(8\)/);
    assert.match(text(row), /3 siswa belum dapat ruang/);
    assert.doesNotMatch(text(row), /\d ruang\b(?! lainnya)/);
    const wide = schedule({ allocated_room_ids: ['a', 'b', 'c', 'd'], allocated_room_counts: { a: 5, b: 5, c: 5, d: 5 } });
    row = find(h.render(h.workspace.CompactExamPeriodSchedules, props([wide], { rooms })), node => node.type === 'tr' && node.props.key === 'ready');
    assert.match(text(row), /Ruang A\(5\)Ruang B\(5\)Ruang C\(5\)\+1 ruang lainnya/);
});

test('both routes enable the compact workspace for ASAS/ASAT (pas, legacy pat) and AM only', () => {
    const { isSemesterAssessmentType } = require('../../web/lib/exam-types.ts');
    for (const role of ['admin', 'proktor']) {
        const source = fs.readFileSync(path.join(web, `app/dashboard/${role}/exams/pas/[id]/page.tsx`), 'utf8');
        const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        let initializer;
        const visit = node => {
            if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'isCompactPeriod') initializer = node.initializer;
            ts.forEachChild(node, visit);
        };
        visit(ast);
        assert.ok(initializer, `${role} exposes a type gate`);
        const gate = new Function('period', 'isSemesterAssessmentType', `return (${initializer.getText(ast)});`);
        const isCompact = period => gate(period, isSemesterAssessmentType);
        for (const type of ['pas', 'pat', 'am']) assert.equal(isCompact({ type }), true, `${role}: ${type}`);
        for (const type of ['pts', 'pkn', 'daily']) assert.equal(isCompact({ type }), false, `${role}: ${type}`);
    }
});
