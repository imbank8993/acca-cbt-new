const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { configuredApiWorkers, runsBackgroundJobs } = require('../src/common/api-cluster.ts');
const { SharedRateLimiter } = require('../src/common/rate-limit.ts');

test('API_WORKERS defaults to a single process and is clamped', () => {
    assert.equal(configuredApiWorkers(undefined), 1);
    assert.equal(configuredApiWorkers(''), 1);
    assert.equal(configuredApiWorkers('abc'), 1);
    assert.equal(configuredApiWorkers('0'), 1);
    assert.equal(configuredApiWorkers('1'), 1);
    assert.equal(configuredApiWorkers('3'), 3);
    assert.equal(configuredApiWorkers('3.9'), 3);
    assert.equal(configuredApiWorkers('64'), 16);
});

test('without cluster the single process runs background jobs and limits locally', async () => {
    assert.equal(runsBackgroundJobs(), true);
    const limiter = new SharedRateLimiter('local');
    for (let i = 0; i < 3; i++) assert.equal(await limiter.hit('k', 3, 60_000), 0);
    assert.ok(await limiter.hit('k', 3, 60_000) > 0);
    assert.ok(await limiter.blocked('k', 3) > 0);
    // reset tetap sinkron tanpa cluster (pemanggil lama tidak menunggu Promise-nya).
    limiter.reset('k');
    assert.equal(await limiter.blocked('k', 3), 0);
});

test('in a real 3-process cluster the limit is shared and background jobs run once', () => {
    const output = execFileSync(process.execPath, [path.join(__dirname, 'fixtures', 'api-cluster-probe.cjs')],
        { encoding: 'utf8', timeout: 60_000 });
    const result = JSON.parse(output.trim().split('\n').pop());
    // 3 proses × 10 percobaan dengan batas 12: tanpa penghitung bersama, 30 lolos.
    assert.equal(result.allowed, 12);
    assert.equal(result.background, 1);
});

test('DB_CONNECTION_LIMIT is the total for the API and is split across cluster processes', () => {
    const { withPoolDefaults } = require('../src/prisma/database-url.ts');
    const url = 'postgresql://u:p@h/db';
    assert.equal(withPoolDefaults(url, { DB_CONNECTION_LIMIT: '30' }), `${url}?connection_limit=30&pool_timeout=20`);
    assert.equal(withPoolDefaults(url, { DB_CONNECTION_LIMIT: '30', API_WORKERS: '3' }), `${url}?connection_limit=10&pool_timeout=20`);
    assert.equal(withPoolDefaults(url, { DB_CONNECTION_LIMIT: '31', API_WORKERS: '3' }), `${url}?connection_limit=11&pool_timeout=20`);
    // Batas bawah per proses.
    assert.equal(withPoolDefaults(url, { DB_CONNECTION_LIMIT: '8', API_WORKERS: '4' }), `${url}?connection_limit=5&pool_timeout=20`);
    // Nilai eksplisit di DATABASE_URL tetap dihormati apa adanya.
    assert.equal(withPoolDefaults(`${url}?connection_limit=7`, { API_WORKERS: '3' }), `${url}?connection_limit=7&pool_timeout=20`);
});

test('parallel password guesses cannot slip past the per-account login limit', async () => {
    const { UnauthorizedException } = require('@nestjs/common');
    const { AuthController, loginFailures } = require('../src/auth/auth.controller.ts');
    await loginFailures.reset('account:race@x.test');
    let checked = 0;
    const controller = new AuthController({ login: async () => {
        checked++;
        await new Promise(resolve => setTimeout(resolve, 20));
        throw new UnauthorizedException('Email atau password salah.');
    } });
    const req = { ip: '198.51.100.7', headers: {} };
    const results = await Promise.allSettled(Array.from({ length: 50 }, () =>
        controller.login({ email: 'race@x.test', password: 'guess' }, req)));
    assert.equal(checked, 10, 'hanya 10 tebakan yang sampai ke pemeriksaan sandi');
    assert.equal(results.filter(r => r.status === 'rejected' && r.reason.getStatus() === 429).length, 40);
    await loginFailures.reset('account:race@x.test');
});
