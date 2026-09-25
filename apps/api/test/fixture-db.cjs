// In-memory query fixture. No database, sockets or credentials.
exports.fixtureDb = function fixtureDb(initial = {}, failedTables = [], options = {}) {
    const tables = structuredClone(initial), queries = [], writes = [];
    let generated = 0;
    const db = { tables, queries, writes,
    raw: async sql => /clock_timestamp|select now/i.test(sql)
        ? [{ now: new Date(options.now || '2026-09-20T00:00:00Z') }]
        : [{ id: 'locked' }],
    async transaction(work) {
        const snapshot = structuredClone(tables);
        try {
            return await work(db);
        } catch (error) {
            for (const key of Object.keys(tables)) delete tables[key];
            Object.assign(tables, snapshot);
            throw error;
        }
    },
    from(table) {
        const predicates = []; let mutation, payload, single = false, limit;
        const calls = []; queries.push({ table, calls });
        const builder = new Proxy({}, { get(_, method) {
            if (method === 'then') return (resolve, reject) => {
                if (failedTables.includes(table)) return Promise.resolve({ data: null, error: { message: 'synthetic failure' } }).then(resolve, reject);
                const source = tables[table] ||= [];
                const match = row => predicates.every(p => p(row));
                let rows = source.filter(match);
                if (mutation) {
                    if (options.failMutation?.table === table &&
                        (!options.failMutation.mutation || options.failMutation.mutation === mutation)) {
                        return Promise.resolve({ data: null, error: { message: 'synthetic mutation failure' } }).then(resolve, reject);
                    }
                    writes.push({ table, mutation, payload, calls });
                    if (mutation === 'update') rows.forEach(row => Object.assign(row, payload));
                    if (mutation === 'delete') tables[table] = source.filter(row => !match(row));
                    if (mutation === 'insert' || mutation === 'upsert') {
                        rows = (Array.isArray(payload) ? payload : [payload]).map(input => {
                            const found = mutation === 'upsert' && source.find(row => {
                                if (input.id) return row.id === input.id;
                                if (input.attempt_id && input.question_id) {
                                    return row.attempt_id === input.attempt_id && row.question_id === input.question_id;
                                }
                                return input.user_id && row.user_id === input.user_id;
                            });
                            if (found) return Object.assign(found, input);
                            const created = { id: `generated-${++generated}`, ...input }; source.push(created); return created;
                        });
                    }
                }
                if (limit !== undefined) rows = rows.slice(0, limit);
                return Promise.resolve({ data: single ? rows[0] || null : rows, error: null, count: rows.length }).then(resolve, reject);
            };
            return (...args) => {
                calls.push([method, ...args]);
                if (method === 'eq') predicates.push(row => row[args[0]] === args[1]);
                if (method === 'neq') predicates.push(row => row[args[0]] !== args[1]);
                if (method === 'in') predicates.push(row => args[1].includes(row[args[0]]));
                if (method === 'gt') predicates.push(row => row[args[0]] > args[1]);
                if (method === 'not' && args[1] === 'in') {
                    const values = Array.isArray(args[2]) ? args[2] : args[2].replace(/[()]/g, '').split(',');
                    predicates.push(row => !values.includes(row[args[0]]));
                }
                if (['insert','update','delete','upsert'].includes(method)) { mutation = method; payload = args[0]; }
                if (['single','maybeSingle'].includes(method)) single = true;
                if (method === 'limit') limit = args[0];
                return builder;
            };
        }});
        return builder;
    }};
    return db;
};
