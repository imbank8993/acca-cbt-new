const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { RelationRegistry } = require('../src/prisma/relation-registry.ts');
const { PostgrestQueryBuilder } = require('../src/prisma/prisma-db-adapter.ts');

function fixture() {
    const state = { migrated: false, loads: 0, fail: false, queries: [] };
    const prisma = { async $queryRawUnsafe(sql, ...params) {
        if (sql.includes('information_schema.columns')) {
            state.loads++;
            if (state.fail) throw new Error('schema unavailable');
            return [{ table_name: 'existing', column_name: 'id', udt_name: 'uuid' }, ...(state.migrated ? [
                { table_name: 'cbt_learning_materials', column_name: 'id', udt_name: 'uuid' },
                { table_name: 'cbt_learning_materials', column_name: 'organization_id', udt_name: 'uuid' },
            ] : [])];
        }
        if (sql.includes('information_schema')) return [];
        state.queries.push({ sql, params }); return [];
    } };
    return { state, prisma, registry: new RelationRegistry(prisma) };
}
test('SCHEMA: table added after startup reloads types before compiling UUID predicates', async () => {
    const { state, prisma, registry } = fixture();
    await registry.ensureLoaded(); state.migrated = true;
    const result = await new PostgrestQueryBuilder('cbt_learning_materials', prisma, registry)
        .select('id').eq('organization_id', '00000000-0000-4000-8000-000000000000');
    assert.equal(result.error, null); assert.equal(state.loads, 2);
    assert.match(state.queries[0].sql, /\$1::uuid/);
    await registry.ensureLoaded('cbt_learning_materials'); assert.equal(state.loads, 2);
});
test('SCHEMA: simultaneous new-table queries share one refresh', async () => {
    const { state, registry } = fixture(); await registry.ensureLoaded(); state.migrated = true;
    await Promise.all(Array.from({ length: 12 }, () => registry.ensureLoaded('cbt_learning_materials')));
    assert.equal(state.loads, 2); assert.equal(registry.columnType('cbt_learning_materials', 'id'), 'uuid');
});
test('SCHEMA: a genuinely missing table does not repeatedly introspect', async () => {
    const { state, registry } = fixture(); await registry.ensureLoaded();
    await registry.ensureLoaded('missing'); await registry.ensureLoaded('missing');
    assert.equal(state.loads, 2);
});
test('SCHEMA: refresh failure preserves known types and can retry', async () => {
    const { state, registry } = fixture(); await registry.ensureLoaded(); state.fail = true;
    await assert.rejects(registry.ensureLoaded('cbt_learning_materials'), /schema unavailable/);
    assert.equal(registry.columnType('existing', 'id'), 'uuid');
    state.fail = false; state.migrated = true;
    await registry.ensureLoaded('cbt_learning_materials');
    assert.equal(registry.columnType('cbt_learning_materials', 'id'), 'uuid');
});
