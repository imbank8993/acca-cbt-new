const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { HealthController } = require('../src/health/health.controller.ts');

function controller(scoringOk) {
    const prisma = { $queryRawUnsafe: async () => [{ db: 'test' }] };
    const registry = { ensureLoaded: async () => {} };
    const db = { from: () => ({
        select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { id: 'org' }, error: null }) }) }),
    }) };
    const scoring = { health: async () => ({ ok: scoringOk, ...(scoringOk ? {} : { detail: 'offline' }) }) };
    return new HealthController(prisma, registry, db, scoring);
}

test('health is unhealthy when scoring service is offline', async () => {
    const result = await controller(false).check();
    assert.equal(result.ok, false);
    assert.deepEqual(result.scoring, { ok: false, detail: 'offline' });
});

test('health is healthy when database, adapter, and scoring are healthy', async () => {
    const result = await controller(true).check();
    assert.equal(result.ok, true);
    assert.deepEqual(result.scoring, { ok: true });
});
