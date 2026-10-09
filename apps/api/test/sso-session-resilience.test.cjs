const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function compile(file) {
    return ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
}
function session(fetch) {
    const context = { exports: {}, fetch, AbortController, setTimeout, clearTimeout };
    vm.runInNewContext(compile('lib/session.ts'), context);
    return context.exports;
}
const student = { success: true, id: 'student', bestRole: 'Siswa' };
const response = (status, body = student) => ({ status, ok: status === 200, json: async () => body });

test('temporary failures never become anonymous sessions; retry recovers', async () => {
    for (const failure of [500, 502, 503, 429, 403, 'network', 'invalid-json']) {
        let failing = true;
        const api = session(async () => {
            if (!failing) return response(200);
            if (failure === 'network') throw new Error('offline');
            if (failure === 'invalid-json') return response(200, null);
            return response(failure);
        });
        await assert.rejects(api.getSessionUser());
        failing = false;
        assert.equal((await api.getSessionUser()).id, 'student');
    }
});

test('temporary failure preserves cached identity, but 401 removes it', async () => {
    let status = 200;
    const api = session(async () => response(status));
    await api.getSessionUser();
    status = 503;
    assert.equal((await api.getSessionUser({ refresh: true })).id, 'student');
    status = 401;
    assert.equal(await api.getSessionUser({ refresh: true }), null);
    assert.equal(await api.getSessionUser(), null);
});

async function home(statuses, cancel = false, search = '?sso_role=Siswa') {
    const events = [], timers = [], failures = [];
    let effect;
    const api = session(async () => {
        const status = statuses.shift();
        if (status === 'network') throw new Error('offline');
        return response(status);
    });
    const context = {
        exports: {}, process: { env: {} }, URLSearchParams,
        window: { location: { search, hash: '', href: '', replace: p => events.push(p) } },
        setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
        require(name) {
            if (name === 'react') return {
                useEffect(fn) { effect = fn; },
                useState() { return [null, value => failures.push(value)]; },
            };
            if (name === 'next/navigation') return { useRouter: () => ({ push: p => events.push(p) }) };
            if (name === '@/lib/session') return api;
            if (name.includes('session-reset')) return { clearCbtSession: async () => events.push('logout') };
            if (name.includes('rbac')) return {
                clearActiveRoleInStorage() {}, setActiveRoleInStorage() {}, lockActiveRole() {},
                getDashboardPath: () => '/dashboard/siswa',
            };
            if (name.includes('useMemoryState')) return { clearMemoryCache() {} };
            return { jsx() {}, jsxs() {} };
        },
    };
    vm.runInNewContext(compile('app/page.tsx'), context);
    context.exports.default();
    const cleanup = effect();
    if (cancel) cleanup();
    await new Promise(setImmediate);
    for (const timer of timers) await timer();
    return { events, failures, href: context.window.location.href };
}

test('SSO landing preserves session on server or network errors, including after a 401', async () => {
    for (const statuses of [[503], ['network'], [401, 503]]) {
        const result = await home(statuses);
        assert.deepEqual(result.events, []);
        assert.equal(result.href, '');
        assert.equal(result.failures[0].retryOnly, true);
    }
});

test('SSO landing routes valid students and redirects only confirmed missing sessions', async () => {
    assert.deepEqual((await home([200])).events, ['/dashboard/siswa']);
    const missing = await home([401, 401], false, '');
    assert.deepEqual(missing.events, ['logout']);
    assert.match(missing.href, /login\?error=cbt-no-session/);
});

test('unmounted SSO landing cannot redirect or clear session', async () => {
    const result = await home([401, 401], true);
    assert.deepEqual(result.events, []);
    assert.equal(result.href, '');
});

test('failed cookie handoff shows recovery without logout redirect loop', async () => {
    const result = await home([401, 401]);
    assert.deepEqual(result.events, []);
    assert.equal(result.href, '');
    assert.equal(result.failures[0].title, 'Sesi CBT belum tersimpan');
});


test('rejected dashboard session offers CBT recovery without redirecting to ACCA login', async () => {
    const result = await home([], false, '?error=cbt-session-unavailable');
    assert.deepEqual(result.events, []);
    assert.equal(result.href, '');
    assert.match(result.failures[0].message, /memperbarui sesi/);
});
