const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

test('exam proxy rejects cross-origin cookie mutations before forwarding', async () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/lib/nest-proxy.ts'), 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    let forwarded = 0;
    const mocks = {
        '@/lib/app-jwt': { extractRequestToken: () => 'student-session' },
        '@/lib/nest-api': { nestFetchAsUser: async () => {
            forwarded++;
            return { status: 200, body: { saved: 1 } };
        } },
        '@/lib/public-origin': { resolvePublicOrigin: () => 'https://exam.example' },
        'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
    };
    new Function('require', 'module', 'exports', code)(name => mocks[name], module, module.exports);
    const request = (method, headers = {}) => ({ method, headers: new Headers(headers) });
    const send = (headers) => module.exports.proxy(
        request('POST', headers), '/students/attempts/attempt/answers', { method: 'PUT', body: '{}' },
    );

    assert.equal((await send({ origin: 'https://exam.example' })).status, 200);
    assert.equal((await send({ 'sec-fetch-site': 'same-origin' })).status, 200);
    assert.equal(forwarded, 2);

    for (const headers of [
        { origin: 'https://other.exam.example', 'sec-fetch-site': 'same-site' },
        { origin: 'https://exam.example.evil.test' },
        { origin: 'null' },
        { 'sec-fetch-site': 'same-site' },
        {},
    ]) {
        assert.equal((await send(headers)).status, 403);
    }
    assert.equal(forwarded, 2);
    assert.equal((await module.exports.proxy(request('GET'), '/students/exams/exam', { method: 'GET' })).status, 200);
});

test('bulk question import checks origin before parsing or uploading media', async () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../web/app/api/question-banks/[bankId]/bulk-import/route.ts'), 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    let parsed = false;
    let uploaded = false;
    const denied = { status: 403 };
    const mocks = {
        '@/lib/app-jwt': { extractRequestToken: () => 'teacher-session' },
        '@/lib/math-equations': { renderEquationsToImages: async () => { uploaded = true; } },
        '@/lib/nest-api': { nestFetchAsUser: async () => { throw new Error('Backend should not be called'); } },
        '@/lib/nest-proxy': { rejectCrossOriginMutation: () => denied, proxy: async () => { throw new Error('Proxy should not be called'); } },
        'next/server': { NextResponse: { json: () => { throw new Error('Should return the guard response'); } } },
    };
    new Function('require', 'module', 'exports', code)(name => mocks[name], module, module.exports);
    const result = await module.exports.POST({ json: async () => { parsed = true; } }, {
        params: Promise.resolve({ bankId: 'bank' }),
    });
    assert.equal(result, denied);
    assert.equal(parsed, false);
    assert.equal(uploaded, false);
});
