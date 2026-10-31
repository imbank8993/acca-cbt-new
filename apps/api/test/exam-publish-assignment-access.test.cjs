const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const web = path.resolve(__dirname, '../../web');

test('assignment batches exclude monitoring-only exams while preserving owned and shared exams', () => {
    const exams = [
        { id: 'own', canManage: true },
        { id: 'foreign-published', canManage: false },
        { id: 'semester-monitoring', canManage: false },
        { id: 'shared-viewer', canManage: false, collaborationPermission: 'viewer' },
    ];
    for (const role of ['guru', 'proktor', 'admin']) {
        const source = fs.readFileSync(path.join(web, `app/dashboard/${role}/exams/page.tsx`), 'utf8');
        const expression = source.match(/const examIds = ([^;]+);/)[1];
        const ids = new Function('examList', `return ${expression}`)(exams);
        // The server rejects a batch containing even one monitoring-only exam.
        assert.equal(ids.some(id => ['foreign-published', 'semester-monitoring'].includes(id)), false, role);
        assert.deepEqual(ids, ['own', 'shared-viewer'], role);
    }
});

function mobilePublish(exam, canPublish, onPublish = () => {}) {
    const source = fs.readFileSync(path.join(web, 'app/components/ExamMobileActions.tsx'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
        esModuleInterop: true,
    } }).outputText;
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
        Fragment: 'fragment', useState: () => [false, () => {}],
    };
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', 'React', code)(name => {
        if (name === 'react') return React;
        return new Proxy({}, { get: (_, key) => String(key) });
    }, mod, mod.exports, React);
    const tree = mod.exports.ExamMobileActions({ exam, canPublish, busy: false, onPublish });
    return tree.children[0].children[0];
}

test('mobile publish can open assignment flow even when assignment data is absent', () => {
    let clicks = 0;
    const button = mobilePublish({ canManage: true, status: 'draft', is_published: false }, false, () => clicks++);
    assert.equal(button.props.disabled, false);
    button.props.onClick();
    assert.equal(clicks, 1);
    assert.equal(mobilePublish({ canManage: true, status: 'draft' }, true).props.disabled, false);
});

test('mobile publish still disables read-only and archived exams', () => {
    assert.equal(mobilePublish({ canManage: false, status: 'draft' }, true).props.disabled, true);
    assert.equal(mobilePublish({ canManage: true, status: 'archived' }, true).props.disabled, true);
});
