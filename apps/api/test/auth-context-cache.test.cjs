// Run from repository root: node --test apps/api/test/auth-context-cache.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });

const {
    TtlCache, AuthContextCache, authContextTtlMs, DEFAULT_AUTH_CONTEXT_TTL_MS, MAX_AUTH_CONTEXT_TTL_MS,
} = require('../src/auth/auth-context-cache.ts');
const { JwtStrategy, sessionVersionAccepted, LEGACY_TOKEN_MAX_AGE_SECONDS } = require('../src/auth/jwt.strategy.ts');
const { SingleSchoolService } = require('../src/auth/single-school.service.ts');
const { fixtureDb } = require('./fixture-db.cjs');

const USER_ID = '11111111-1111-4111-8111-111111111111';
/** Token sah: membawa versi sesi akun saat ini. */
const TOKEN = { sub: USER_ID, sessionVersion: 'v1' };

test('TTL env: default, disable with 0, invalid falls back, capped at maximum', () => {
    assert.equal(authContextTtlMs(undefined), DEFAULT_AUTH_CONTEXT_TTL_MS);
    assert.equal(authContextTtlMs(''), DEFAULT_AUTH_CONTEXT_TTL_MS);
    assert.equal(authContextTtlMs('0'), 0);
    assert.equal(authContextTtlMs('-5'), DEFAULT_AUTH_CONTEXT_TTL_MS);
    assert.equal(authContextTtlMs('abc'), DEFAULT_AUTH_CONTEXT_TTL_MS);
    assert.equal(authContextTtlMs('9999999'), MAX_AUTH_CONTEXT_TTL_MS);
});

test('cache hit within TTL, reload after expiry', async () => {
    let now = 0;
    let loads = 0;
    const cache = new TtlCache(1000, { now: () => now });
    const load = async () => ++loads;
    assert.equal(await cache.get('a', load), 1);
    now = 999;
    assert.equal(await cache.get('a', load), 1);
    now = 1000;
    assert.equal(await cache.get('a', load), 2);
});

test('concurrent misses share one load (single-flight)', async () => {
    let loads = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const cache = new TtlCache(1000);
    const load = async () => { loads++; await gate; return 'v'; };
    const all = Promise.all(Array.from({ length: 50 }, () => cache.get('a', load)));
    release();
    assert.deepEqual(new Set(await all), new Set(['v']));
    assert.equal(loads, 1);
});

test('failures are never cached', async () => {
    let fail = true;
    const cache = new TtlCache(1000);
    const load = async () => { if (fail) throw new Error('db down'); return 'ok'; };
    await assert.rejects(cache.get('a', load), /db down/);
    fail = false;
    assert.equal(await cache.get('a', load), 'ok');
});

test('invalidation during an in-flight load prevents storing the stale value', async () => {
    let value = 'old';
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const cache = new TtlCache(1000);
    const first = cache.get('a', async () => { const v = value; await gate; return v; });
    cache.invalidate('a');
    value = 'new';
    release();
    assert.equal(await first, 'old');
    assert.equal(await cache.get('a', async () => value), 'new');
});

test('TTL 0 disables caching; cacheIf filters; size is bounded', async () => {
    let loads = 0;
    const off = new TtlCache(0);
    await off.get('a', async () => ++loads);
    await off.get('a', async () => ++loads);
    assert.equal(loads, 2);

    const filtered = new TtlCache(1000, { cacheIf: v => Boolean(v) });
    let calls = 0;
    await filtered.get('x', async () => { calls++; return null; });
    await filtered.get('x', async () => { calls++; return null; });
    assert.equal(calls, 2);

    const bounded = new TtlCache(1000, { maxEntries: 3 });
    for (const key of ['a', 'b', 'c', 'd', 'e']) await bounded.get(key, async () => key);
    assert.equal(bounded.size, 3);
});

function strategy({ aktif = true } = {}) {
    const counts = { findById: 0, publicUsers: 0, resolve: 0 };
    const state = { aktif, roles: ['SISWA'], sessionVersion: 'v1' };
    const prisma = {
        $queryRawUnsafe: async sql => {
            if (/FROM public\.users/.test(sql)) {
                counts.publicUsers++;
                return [{ id: 1n, aktif: state.aktif, nama: 'Siswa', nama_lengkap: 'Siswa Satu' }];
            }
            return [];
        },
    };
    const authUsers = {
        findById: async id => { counts.findById++; return { id, email: 'Siswa@Sekolah', raw_user_meta_data: {}, raw_app_meta_data: { session_version: state.sessionVersion }, banned_until: null }; },
    };
    const roles = {
        resolve: async () => {
            counts.resolve++;
            return {
                roleNames: [...state.roles], resolved: { siswa: true }, bestRole: 'Siswa',
                organizationId: 'school', organizationName: 'Sekolah', isPlatformAdmin: false,
            };
        },
    };
    const cache = new AuthContextCache();
    const jwt = new JwtStrategy({ get: () => 'test-secret' }, prisma, authUsers, roles, cache);
    return { jwt, cache, counts, state };
}

test('JwtStrategy reads the database once per user within the TTL', async () => {
    const { jwt, counts } = strategy();
    for (let i = 0; i < 20; i++) await jwt.validate(TOKEN);
    assert.deepEqual(counts, { findById: 1, publicUsers: 1, resolve: 1 });
    const user = await jwt.validate(TOKEN);
    assert.equal(user.id, USER_ID);
    assert.equal(user.email, 'siswa@sekolah');
    assert.equal(user.fullName, 'Siswa Satu');
});

test('callers mutating request.user do not pollute the cache', async () => {
    const { jwt } = strategy();
    const first = await jwt.validate(TOKEN);
    first.roles.push('ADMIN');
    first.resolved.admin = true;
    first.bestRole = 'Admin';
    const second = await jwt.validate(TOKEN);
    assert.deepEqual(second.roles, ['SISWA']);
    assert.equal(second.resolved.admin, undefined);
    assert.equal(second.bestRole, 'Siswa');
});

test('invalidate forces a fresh read so role changes apply immediately', async () => {
    const { jwt, cache, counts, state } = strategy();
    await jwt.validate(TOKEN);
    state.roles = ['GURU'];
    assert.deepEqual((await jwt.validate(TOKEN)).roles, ['SISWA']);
    cache.invalidate(USER_ID);
    assert.deepEqual((await jwt.validate(TOKEN)).roles, ['GURU']);
    assert.equal(counts.resolve, 2);
});

test('rejections (deactivated account) are not cached', async () => {
    const { jwt, counts, state } = strategy({ aktif: false });
    await assert.rejects(jwt.validate(TOKEN), /dinonaktifkan/);
    await assert.rejects(jwt.validate(TOKEN), /dinonaktifkan/);
    assert.equal(counts.findById, 2);
    state.aktif = true;
    assert.equal((await jwt.validate(TOKEN)).id, USER_ID);
});

test('school row is read once and reused; failures are not cached', async () => {
    const db = fixtureDb({ cbt_organizations: [{ id: 'school-1', name: 'Sekolah Satu', logo_url: null }] });
    let reads = 0;
    const counted = { from: table => { if (table === 'cbt_organizations') reads++; return db.from(table); } };
    const service = new SingleSchoolService(counted, { get: () => undefined });
    await Promise.all(Array.from({ length: 10 }, () => service.getSchool()));
    await service.getSchool();
    assert.equal(reads, 1);
    const copy = await service.getSchool();
    copy.id = 'mutated';
    assert.equal((await service.getSchool()).id, 'school-1');

    const broken = new SingleSchoolService(fixtureDb({
        cbt_organizations: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    }), { get: () => undefined });
    await assert.rejects(broken.getSchool(), /lebih dari satu sekolah/);
    await assert.rejects(broken.getSchool(), /lebih dari satu sekolah/);
});

test('session version: acca-new revocation also ends CBT access', async () => {
    const { jwt, cache, state } = strategy();
    assert.equal((await jwt.validate(TOKEN)).id, USER_ID);
    // acca-new: logout semua sesi / ganti password → session_version baru.
    state.sessionVersion = 'v2';
    cache.invalidate(USER_ID);
    await assert.rejects(jwt.validate(TOKEN), /Sesi telah berakhir/);
    assert.equal((await jwt.validate({ sub: USER_ID, sessionVersion: 'v2' })).id, USER_ID);
});

test('session version: a token newer than the cached copy is re-read, not rejected', async () => {
    const { jwt, state, counts } = strategy();
    await jwt.validate(TOKEN);
    state.sessionVersion = 'v2';
    // Pengguna login ulang di proses lain; cache proses ini masih menyimpan v1.
    assert.equal((await jwt.validate({ sub: USER_ID, sessionVersion: 'v2' })).id, USER_ID);
    assert.equal(counts.findById, 2);
});

test('session version: claimless legacy tokens only within the old 12-hour lifetime', () => {
    const now = 1_800_000_000;
    assert.equal(sessionVersionAccepted({ sessionVersion: '' }, ''), true);
    assert.equal(sessionVersionAccepted({ sessionVersion: 'a' }, 'b'), false);
    assert.equal(sessionVersionAccepted({ iat: now - 60 }, 'anything', now), true);
    assert.equal(sessionVersionAccepted({ iat: now - LEGACY_TOKEN_MAX_AGE_SECONDS - 1 }, 'anything', now), false);
    assert.equal(sessionVersionAccepted({}, '', now), false);
});

test('CBT-issued tokens carry the session version and revocation bumps it', () => {
    const fs = require('node:fs');
    const auth = fs.readFileSync(path.resolve(__dirname, '../src/auth/auth.service.ts'), 'utf8');
    assert.match(auth, /role: context\.roleNames\.join\(','\),\s*sessionVersion,/);
    assert.equal(auth.split('sessionVersionOf(user.raw_app_meta_data)').length - 1, 3);
    const repo = fs.readFileSync(path.resolve(__dirname, '../src/auth/auth-users.repository.ts'), 'utf8');
    assert.match(repo, /async revokeSessions[\s\S]{0,1200}jsonb_build_object\('session_version'/);
});
