#!/usr/bin/env node
/**
 * Ukur cakupan adapter query terhadap database sungguhan.
 *
 * Mengekstrak setiap pasangan `.from('tabel')…select(…)` dari apps/api,
 * mengompilasinya dengan compiler select yang dipakai NestJS, lalu menjalankan
 * SQL hasilnya ke database.
 *
 * Dulu yang dipindai adalah apps/web, dan pertanyaannya "berapa banyak query
 * yang bisa dipindahkan apa adanya?". Seluruh query sudah pindah, jadi
 * pertanyaannya kini berbeda dan lebih berguna: apakah setiap query yang
 * BENAR-BENAR dijalankan NestJS masih cocok dengan skema database?
 *
 * Hanya membaca — setiap query diberi LIMIT 1 dan tidak ada yang ditulis.
 *
 *   DATABASE_URL="postgresql://…/acca_db" node tools/check-adapter-coverage.js
 *
 * Dengan `--with-migrations`, berkas di database/migrations diterapkan lebih
 * dulu di dalam transaksi yang diakhiri ROLLBACK. Itu menjawab pertanyaan yang
 * sebenarnya: berapa banyak query yang akan lolos SETELAH migrasi dijalankan?
 *
 * Bila DATABASE_URL tidak diset, berkas apps/api/.env dibaca.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const API_SRC = path.join(ROOT, 'apps', 'api', 'src');
const SELECT_COMPILER = path.join(ROOT, 'apps', 'api', 'src', 'prisma', 'postgrest-select.ts');

function resolveDatabaseUrl() {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
    const envPath = path.join(ROOT, 'apps', 'api', '.env');
    if (!fs.existsSync(envPath)) {
        console.error('DATABASE_URL tidak diset dan apps/api/.env tidak ditemukan.');
        process.exit(1);
    }
    const match = fs.readFileSync(envPath, 'utf8').match(/DATABASE_URL="?([^"\n]+)"?/);
    if (!match) {
        console.error('DATABASE_URL tidak ditemukan di apps/api/.env.');
        process.exit(1);
    }
    return match[1];
}

function loadSelectCompiler() {
    // Compiler-nya TypeScript; di-bundle ke CJS sementara agar bisa dipakai di
    // sini. Impornya ke RelationRegistry hanya bersifat tipe, jadi hilang saat
    // transpilasi — registry di bawah dibangun dari FK database yang sebenarnya.
    const out = path.join(os.tmpdir(), `postgrest-select-${process.pid}.cjs`);
    // shell: true diperlukan di Windows — npx adalah berkas .cmd, dan
    // spawn tanpa shell menolaknya dengan EINVAL.
    execFileSync(
        'npx',
        ['--yes', 'esbuild@0.25.0', JSON.stringify(SELECT_COMPILER), '--bundle',
            '--platform=node', '--format=cjs', '--log-level=error',
            `--outfile=${JSON.stringify(out)}`],
        { stdio: ['ignore', 'ignore', 'inherit'], cwd: ROOT, shell: true },
    );
    const compiler = require(out);
    process.on('exit', () => { try { fs.unlinkSync(out); } catch { /* abaikan */ } });
    return compiler;
}

function collectSourceFiles(dir, acc = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.next') continue;
            collectSourceFiles(full, acc);
        } else if (/\.tsx?$/.test(entry.name)) {
            acc.push(full);
        }
    }
    return acc;
}

function extractSelects() {
    const cases = [];
    const pattern =
        /\.from\(\s*'([a-zA-Z0-9_]+)'\s*\)([\s\S]{0,1400}?)\.select\(\s*(`[\s\S]*?`|'[^']*'|"[^"]*")/g;

    for (const file of collectSourceFiles(API_SRC)) {
        const source = fs.readFileSync(file, 'utf8');
        let match;
        while ((match = pattern.exec(source))) {
            const [, table, between, rawSelect] = match;
            // `.from()` lain di antaranya berarti regex menyeberangi dua query.
            if (between.includes('.from(')) continue;
            const select = rawSelect.slice(1, -1);
            // Select yang dirakit saat berjalan tidak bisa diperiksa statis.
            if (select.includes('${')) continue;
            cases.push({
                file: path.relative(API_SRC, file).split(path.sep).join('/'),
                table,
                select: select.replace(/\s+/g, ' ').trim(),
            });
        }
    }
    return cases;
}

async function buildRegistry(client) {
    const fks = (await client.query(`
        SELECT tc.table_name AS src, kcu.column_name AS src_col,
               ccu.table_name AS tgt, ccu.column_name AS tgt_col,
               tc.constraint_name AS cn
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`)).rows;

    const pks = (await client.query(`
        SELECT tc.table_name AS t, kcu.column_name AS col,
               COUNT(*) OVER (PARTITION BY tc.constraint_name)::int AS n
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'`)).rows;

    const primaryKeys = new Map(pks.filter((r) => r.n === 1).map((r) => [r.t, r.col]));

    return {
        primaryKeyOf: (table) => primaryKeys.get(table) || 'id',
        resolve(parent, target, hint) {
            const belongsTo = fks.filter((e) => e.src === parent && e.tgt === target);
            const hasMany = fks.filter((e) => e.src === target && e.tgt === parent);

            if (hint) {
                const edge =
                    belongsTo.find((e) => e.src_col === hint || e.cn === hint) ||
                    hasMany.find((e) => e.src_col === hint || e.cn === hint);
                if (edge) {
                    return edge.src === parent
                        ? { kind: 'belongsTo', parentColumn: edge.src_col, childColumn: edge.tgt_col }
                        : { kind: 'hasMany', parentColumn: edge.tgt_col, childColumn: edge.src_col };
                }
            }
            if (belongsTo.length === 1) {
                return { kind: 'belongsTo', parentColumn: belongsTo[0].src_col, childColumn: belongsTo[0].tgt_col };
            }
            if (belongsTo.length === 0 && hasMany.length === 1) {
                return { kind: 'hasMany', parentColumn: hasMany[0].tgt_col, childColumn: hasMany[0].src_col };
            }
            if (belongsTo.length > 1 || hasMany.length > 1) {
                throw new Error(`Relasi '${parent}' → '${target}' ambigu.`);
            }
            return null;
        },
    };
}

/**
 * Terapkan migrasi di dalam transaksi berjalan. Pemanggil yang bertanggung
 * jawab melakukan ROLLBACK — fungsi ini tidak pernah menyimpan apa pun.
 */
async function applyMigrations(client) {
    const dir = path.join(ROOT, 'database', 'migrations');
    // Hanya berkas bernomor tanggal, dijalankan berurutan. Pola penamaannya
    // yang menentukan urutan, jadi SQL lepas di direktori ini tidak ikut
    // terjalankan tanpa sengaja.
    const files = fs
        .readdirSync(dir)
        .filter((f) => /^\d{8}_\d{2}_.+\.sql$/.test(f))
        .sort();

    for (const file of files) {
        const sql = fs
            .readFileSync(path.join(dir, file), 'utf8')
            .split('\n')
            // Kontrol transaksi milik berkas dibuang; COMMIT di dalamnya akan
            // menyimpan perubahan, persis yang harus dicegah.
            .filter((line) => !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/i.test(line))
            .join('\n');
        await client.query(sql);
    }
    return files;
}

(async () => {
    const { Client } = require('pg');
    const { parseSelect, compileSelect, buildPredicate } = loadSelectCompiler();
    const withMigrations = process.argv.includes('--with-migrations');

    const cases = extractSelects();
    const client = new Client({ connectionString: resolveDatabaseUrl(), connectionTimeoutMillis: 20000 });
    await client.connect();

    if (withMigrations) {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '5s'");
        const files = await applyMigrations(client);
        console.log(`migrasi diterapkan sementara: ${files.length} berkas (akan di-ROLLBACK)\n`);
    }

    const registry = await buildRegistry(client);

    // Tipe kolom, meniru RelationRegistry.columnType di adapter. Tanpa ini
    // filter pada kolom uuid akan diikat sebagai text dan PostgreSQL menolaknya
    // dengan "operator does not exist: uuid = text".
    const columnTypes = new Map();
    for (const row of (await client.query(
        `SELECT table_name, column_name, udt_name FROM information_schema.columns
          WHERE table_schema = 'public'`,
    )).rows) {
        if (!columnTypes.has(row.table_name)) columnTypes.set(row.table_name, new Map());
        columnTypes.get(row.table_name).set(row.column_name, row.udt_name);
    }
    const columnType = (t, c) => columnTypes.get(t)?.get(c) ?? null;
    const existing = new Set(
        (await client.query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
        )).rows.map((r) => r.table_name),
    );

    const ok = [];
    const filterOk = new Set();
    const filterFailed = [];
    const missingTable = [];
    const compileFailed = [];
    const sqlFailed = [];

    for (const testCase of cases) {
        if (!existing.has(testCase.table)) {
            missingTable.push(testCase);
            continue;
        }

        let sql;
        const params = [];
        try {
            const push = (value) => {
                params.push(value);
                return `$${params.length}`;
            };
            const { expressions, conditions } = compileSelect(parseSelect(testCase.select), {
                table: testCase.table,
                sqlAlias: testCase.table,
                registry,
                push,
                filters: [],
                counter: { value: 0 },
            });
            sql = `SELECT ${expressions.join(', ')} FROM public."${testCase.table}" "${testCase.table}"`;
            if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
            sql += ' LIMIT 1';
        } catch (error) {
            compileFailed.push({ ...testCase, error: error.message });
            continue;
        }

        try {
            // Di dalam transaksi, satu query gagal akan membatalkan seluruh
            // transaksi dan membuat semua query berikutnya ikut gagal. SAVEPOINT
            // mengisolasi tiap percobaan sehingga kegagalannya tetap terhitung
            // satu per satu.
            if (withMigrations) await client.query('SAVEPOINT probe');
            await client.query(sql, params);
            if (withMigrations) await client.query('RELEASE SAVEPOINT probe');
            ok.push(testCase);
        } catch (error) {
            if (withMigrations) await client.query('ROLLBACK TO SAVEPOINT probe');
            sqlFailed.push({ ...testCase, error: error.message });
            continue;
        }

        // Probe kedua: query yang SAMA ditambah filter pada primary key.
        //
        // Versi sebelumnya hanya menguji bentuk select tanpa satu pun filter,
        // sehingga melewatkan seluruh kelas kegagalan
        // "operator does not exist: uuid = text" — padahal hampir setiap query
        // nyata memakai .eq() pada kolom uuid.
        const pk = registry.primaryKeyOf(testCase.table);
        const pkType = columnType(testCase.table, pk);
        if (!pkType) continue;

        try {
            const filterParams = [];
            const push = (v) => { filterParams.push(v); return `$${filterParams.length}`; };
            const predicate = buildPredicate(
                `"${testCase.table}"."${pk}"`,
                'eq',
                pkType === 'uuid' ? '00000000-0000-0000-0000-000000000000' : 0,
                push,
                pkType,
            );
            const filterSql =
                `SELECT 1 FROM public."${testCase.table}" "${testCase.table}" WHERE ${predicate} LIMIT 1`;
            if (withMigrations) await client.query('SAVEPOINT fprobe');
            await client.query(filterSql, filterParams);
            if (withMigrations) await client.query('RELEASE SAVEPOINT fprobe');
            filterOk.add(testCase.table);
        } catch (error) {
            if (withMigrations) await client.query('ROLLBACK TO SAVEPOINT fprobe');
            filterFailed.push({ table: testCase.table, error: error.message });
        }
    }

    if (withMigrations) {
        await client.query('ROLLBACK');
        console.log('migrasi sementara dibatalkan — database tidak berubah\n');
    }

    await client.end();

    console.log('=== CAKUPAN ADAPTER QUERY ===');
    console.log(`select diuji       : ${cases.length}`);
    console.log(`berhasil           : ${ok.length}`);
    console.log(`tabel belum ada    : ${missingTable.length}`);
    console.log(`gagal kompilasi    : ${compileFailed.length}`);
    console.log(`gagal SQL          : ${sqlFailed.length}`);
    console.log(`filter .eq() diuji : ${filterOk.size} tabel lolos, ${filterFailed.length} gagal`);

    if (compileFailed.length) {
        console.log('\n--- gagal kompilasi (cacat adapter) ---');
        compileFailed.forEach((c) => console.log(`  [${c.table}] ${c.file}\n     ${c.error}`));
    }
    if (sqlFailed.length) {
        console.log('\n--- gagal SQL (umumnya kolom belum ada) ---');
        sqlFailed.forEach((c) => console.log(`  [${c.table}] ${c.file}\n     ${c.error}`));
    }
    if (filterFailed.length) {
        console.log('\n--- filter .eq() gagal (cast tipe kolom) ---');
        [...new Map(filterFailed.map((f) => [f.table, f])).values()]
            .forEach((f) => console.log(`  [${f.table}] ${f.error}`));
    }
    if (missingTable.length) {
        console.log('\n--- tabel belum ada di database ---');
        console.log('  ' + [...new Set(missingTable.map((c) => c.table))].join(', '));
    }

    // Hanya kegagalan kompilasi yang menandakan cacat adapter. Tabel dan kolom
    // yang belum ada adalah pekerjaan migrasi database, bukan bug di sini.
    process.exit(compileFailed.length > 0 || filterFailed.length > 0 ? 1 : 0);
})().catch((error) => {
    console.error('GAGAL:', error.message);
    process.exit(1);
});
