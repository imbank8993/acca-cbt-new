const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { NextRequest, NextResponse } = require('next/server');
function load(file, env, imports = {}) {
    const source = fs.readFileSync(path.resolve(__dirname, '../../web', file), 'utf8');
    const context = { exports: {}, process: { env }, URL, Buffer, TextEncoder,
        require(name) { if (name in imports) return imports[name]; if (name === 'next/server') return { NextRequest, NextResponse }; throw Error(name); } };
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
    return context.exports;
}
const env = { NODE_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'https://acca-cbt.icgowa.sch.id' };
const origin = load('lib/public-origin.ts', env);
const jwt = load('lib/app-jwt.ts', env, { jose: { jwtVerify: async () => ({ payload: { sub: 'student' } }) } });
const request = (host = 'acca-cbt.icgowa.sch.id', suffix = '/api/auth/sso?token=fixture') => new NextRequest(`http://web:3008${suffix}`, { headers: { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'http' } });
test('production redirect ignores HTTP upstream and uses canonical HTTPS; local HTTP remains usable', () => {
    assert.equal(origin.resolvePublicOrigin(request()), env.NEXT_PUBLIC_SITE_URL);
    const dev = load('lib/public-origin.ts', { NODE_ENV: 'development', NEXT_PUBLIC_SITE_URL: env.NEXT_PUBLIC_SITE_URL });
    assert.equal(dev.resolvePublicOrigin(request('localhost:3008')), 'http://localhost:3008');
    const wrongScheme = load('lib/public-origin.ts', { ...env, NEXT_PUBLIC_SITE_URL: 'http://acca-cbt.icgowa.sch.id' });
    assert.equal(wrongScheme.resolvePublicOrigin(request()), env.NEXT_PUBLIC_SITE_URL);
});
test('SSO success issues protected cookie and HTTPS redirect without protocol redirect loop', async () => {
    let calls = 0;
    const route = load('app/api/auth/sso/route.ts', env, { '@/lib/public-origin': origin, '@/lib/app-jwt': jwt,
        '@/lib/nest-api': { nestFetchInternal: async () => { calls++; return { status: 200, body: { access_token: 'fixture', user: { bestRole: 'Siswa' } } }; } } });
    const result = await route.GET(request());
    assert.equal(calls, 1);
    assert.equal(result.headers.get('location'), `${env.NEXT_PUBLIC_SITE_URL}/?sso_role=Siswa`);
    const cookie = result.headers.get('set-cookie');
    assert.match(cookie, /__Host-cbt_session=/); assert.match(cookie, /Secure/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /Path=\//); assert.doesNotMatch(cookie, /Domain=/i);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    const alias = await route.GET(request('alias.example.test'));
    assert.equal(calls, 1); assert.equal(alias.headers.get('set-cookie'), null);
    assert.equal(alias.headers.get('location'), `${env.NEXT_PUBLIC_SITE_URL}/api/auth/sso?token=fixture`);
    const missing = await route.GET(request('acca-cbt.icgowa.sch.id', '/api/auth/sso'));
    assert.equal(missing.headers.get('location'), `${env.NEXT_PUBLIC_SITE_URL}/?error=missing-token`);
});
test('new protected cookie takes precedence over duplicate legacy cookies; legacy sessions remain readable', () => {
    const req = new NextRequest('https://acca-cbt.icgowa.sch.id', { headers: { cookie: `cbt_session=old; __Host-cbt_session=${jwt.encodeSessionCookie('new')}; cbt_session=stale` } });
    assert.equal(jwt.extractRequestToken(req), 'new');
    assert.equal(jwt.extractRequestToken(new NextRequest(req.url, { headers: { cookie: 'cbt_session=legacy' } })), 'legacy');
});
test('dashboard rejection returns HTTPS even with HTTP proxy headers', async () => {
    const middleware = load('middleware.ts', env, { '@/lib/public-origin': origin, '@/lib/app-jwt': jwt });
    const response = await middleware.middleware(request('acca-cbt.icgowa.sch.id', '/dashboard/siswa'));
    assert.equal(response.headers.get('location'), `${env.NEXT_PUBLIC_SITE_URL}/`);
});
test('logout clears both current and legacy cookies', async () => {
    const route = load('app/api/auth/logout/route.ts', env, { '@/lib/app-jwt': jwt });
    const response = await route.POST();
    const cookies = response.headers.get('set-cookie');
    assert.match(cookies, /__Host-cbt_session=;/); assert.match(cookies, /cbt_session=;/); assert.match(cookies, /Max-Age=0/);
});

test('invalid SSO ticket remains HTTPS and never issues a session', async () => {
    const route = load('app/api/auth/sso/route.ts', env, { '@/lib/public-origin': origin, '@/lib/app-jwt': jwt,
        '@/lib/nest-api': { nestFetchInternal: async () => ({ status: 401, body: { message: 'expired' } }) } });
    const result = await route.GET(request());
    assert.equal(new URL(result.headers.get('location')).origin, env.NEXT_PUBLIC_SITE_URL);
    assert.equal(result.headers.get('set-cookie'), null);
});
test('production middleware sets HSTS and prevents auth caching without redirecting upstream HTTP', async () => {
    const route = load('middleware.ts', env, { '@/lib/public-origin': origin, '@/lib/app-jwt': jwt });
    const response = await route.middleware(request('acca-cbt.icgowa.sch.id', '/api/auth/me'));
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
});
