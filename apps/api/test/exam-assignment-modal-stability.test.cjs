const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve(__dirname, '../../web/components/exams/AssignExamModal.tsx'), 'utf8');
const code = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

// Model effect dependencies and cleanup so parent refreshes and stale requests
// exercise the same initialization lifecycle as the mounted React component.
function mountPicker(overrides = {}, api = {}) {
    const hooks = [];
    const timers = new Map();
    let cursor = 0;
    let nextTimer = 0;
    let pending = [];
    let tree;
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
        useState(initial) {
            const index = cursor++;
            if (!(index in hooks)) hooks[index] = initial;
            return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }];
        },
        useMemo: fn => fn(),
        useEffectEvent(fn) {
            const index = cursor++;
            if (!hooks[index]) hooks[index] = { current: fn, event: (...args) => hooks[index].current(...args) };
            hooks[index].current = fn;
            return hooks[index].event;
        },
        useEffect(fn, deps) {
            const index = cursor++;
            const previous = hooks[index];
            if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
                pending.push(() => {
                    previous?.cleanup?.();
                    hooks[index] = { deps, cleanup: fn() };
                });
            }
        },
    };
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', 'window', code)(name => {
        if (name === 'react') return React;
        if (name === '@/lib/exam-class-selection') return { currentRegularClasses: classes => classes };
        if (name === '@/lib/monitoring-health') return { formatStudentName: name => name };
        if (name === '@/lib/api/proctor') return { getActiveSchoolYear: async () => ({ year: '2026/2027' }), ...api };
        return new Proxy({}, { get: (_, key) => String(key) });
    }, mod, mod.exports, {
        setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
        clearTimeout(id) { timers.delete(id); },
    });
    let saved;
    const props = {
        isOpen: true, onClose() {},
        classes: [{ id: 'a', name: 'X A' }],
        classStudents: { a: [{ id: 'one', full_name: 'Siswa Satu' }, { id: 'two', full_name: 'Siswa Dua' }] },
        initialSelectedClassIds: [], initialClassAssignments: {},
        onSaveAssignments(ids, assignments) { saved = { ids, assignments }; },
        ...overrides,
    };
    const nodes = root => !root || typeof root !== 'object' ? [] : Array.isArray(root) ? root.flatMap(nodes) : [root, ...nodes(root.children)];
    const text = root => root == null || typeof root === 'boolean' ? '' : typeof root !== 'object' ? String(root) : Array.isArray(root) ? root.map(text).join('') : text(root.children);
    const render = () => {
        cursor = 0;
        tree = mod.exports.AssignExamModal(props);
        const effects = pending;
        pending = [];
        effects.forEach(fn => fn());
        return tree;
    };
    const settle = async () => {
        const callbacks = [...timers.values()];
        timers.clear();
        callbacks.forEach(fn => fn());
        await new Promise(resolve => setImmediate(resolve));
        render();
    };
    const find = predicate => {
        const node = nodes(tree).find(predicate);
        assert.ok(node, 'Expected modal control');
        return node;
    };
    return {
        props, render, settle, get saved() { return saved; },
        classCheckbox: () => find(n => n.type === 'input' && n.props['aria-label'] === 'Pilih kelas X A'),
        button: label => find(n => (n.type === 'button' || n.type === 'Button') && text(n) === label),
        studentCheckbox: () => find(n => n.type === 'input' && n.props.type === 'checkbox' && !n.props['aria-label']),
    };
}

test('parent callback, class and initial-value refreshes preserve unsaved class and individual student choices', async () => {
    const picker = mountPicker();
    picker.render();
    await picker.settle();
    picker.classCheckbox().props.onChange({ stopPropagation() {} });
    picker.render();
    picker.button('Pilih Tertentu').props.onClick();
    picker.render();
    picker.studentCheckbox().props.onChange();
    picker.render();

    const save = picker.props.onSaveAssignments;
    picker.props.onSaveAssignments = (...args) => save(...args);
    picker.props.classes = picker.props.classes.map(cls => ({ ...cls }));
    picker.props.initialSelectedClassIds = [];
    picker.props.initialClassAssignments = {};
    picker.render();
    await picker.settle();

    assert.equal(picker.classCheckbox().props.checked, true);
    assert.equal(picker.studentCheckbox().props.checked, true);
    picker.button('Terapkan Peserta').props.onClick();
    assert.deepEqual(picker.saved, { ids: ['a'], assignments: { a: { mode: 'selected', studentIds: ['one'] } } });

    picker.props.isOpen = false;
    picker.render();
    await picker.settle();
    picker.props.initialSelectedClassIds = ['a'];
    picker.props.initialClassAssignments = { a: { mode: 'selected', studentIds: ['two'] } };
    picker.props.isOpen = true;
    picker.render();
    await picker.settle();
    picker.button('Terapkan Peserta').props.onClick();
    assert.deepEqual(picker.saved.assignments.a.studentIds, ['two']);
});

test('existing exam refresh does not refetch or replace edited assignments; switching exam discards stale responses', async () => {
    const requests = [];
    const picker = mountPicker({ exam: { id: 'exam-a', metadata: {} }, onSaveAssignments: undefined }, {
        listExamAssignmentsAction(ids) {
            return new Promise(resolve => requests.push({ ids, resolve }));
        },
    });
    picker.render();
    await picker.settle();
    assert.equal(picker.button('Tetapkan Ujian').props.disabled, true);
    picker.props.exam = { ...picker.props.exam };
    picker.props.classes = [...picker.props.classes];
    picker.render();
    await picker.settle();
    assert.equal(requests.length, 1);

    picker.props.exam = { id: 'exam-b', metadata: {} };
    picker.render();
    await picker.settle();
    assert.deepEqual(requests.map(r => r.ids), [['exam-a'], ['exam-b']]);
    requests[1].resolve({ targets: [{ class_id: 'a' }], participants: [] });
    await picker.settle();
    assert.equal(picker.classCheckbox().props.checked, true);
    picker.classCheckbox().props.onChange({ stopPropagation() {} });
    picker.render();
    requests[0].resolve({ targets: [{ class_id: 'a' }], participants: [] });
    await picker.settle();
    picker.props.exam = { ...picker.props.exam };
    picker.render();
    await picker.settle();
    assert.equal(picker.classCheckbox().props.checked, false);
    assert.equal(requests.length, 2);
});
