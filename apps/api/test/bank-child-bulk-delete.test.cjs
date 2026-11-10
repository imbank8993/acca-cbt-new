const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require('ts-node').register({
    project: path.resolve(__dirname, '../../web/tsconfig.json'),
    transpileOnly: true,
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node' },
});

const { deleteBankChildItems } = require('../../web/lib/bulk-bank-child-delete.ts');

test('bulk deletion preserves failed IDs when requests fail or throw', async () => {
    const removed = [];
    const result = await deleteBankChildItems(['a', 'b', 'c', 'd'], async id => {
        removed.push(id);
        if (id === 'b') return { success: false, error: 'Masih digunakan' };
        if (id === 'd') throw new Error('Jaringan terputus');
        return { success: true };
    });
    assert.deepEqual(removed, ['a', 'b', 'c', 'd']);
    assert.deepEqual(result, { failedIds: ['b', 'd'], firstError: 'Masih digunakan' });
});

test('bulk deletion limits concurrent requests while processing all selected IDs', async () => {
    let active = 0;
    let peak = 0;
    const ids = Array.from({ length: 12 }, (_, index) => String(index));
    const result = await deleteBankChildItems(ids, async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active -= 1;
        return { success: true };
    });
    assert.equal(peak, 5);
    assert.deepEqual(result.failedIds, []);
});
