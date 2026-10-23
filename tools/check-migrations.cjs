// Pemeriksaan baca-saja: tabel dan kolom yang ditambahkan berkas migrasi sudah ada di database?
// Pemakaian: node tools/check-migrations.cjs [--since=20261001]
// Tidak mengubah apa pun. Berkas dengan tabel/kolom yang hilang perlu diterapkan:
//   node tools/apply-migrations.js --files=<berkas> --confirm
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const dir = path.join(__dirname, '../database/migrations');
const since = (process.argv.find(arg => arg.startsWith('--since=')) || '').slice(8);
const strip = sql => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const name = value => value.replace(/^public\./i, '').replace(/"/g, '').toLowerCase();

function expectations(sql) {
    const tables = new Set(), columns = [];
    for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi)) tables.add(name(match[1]));
    for (const statement of sql.split(';')) {
        const alter = statement.match(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([\w."]+)/i);
        if (!alter) continue;
        for (const add of statement.matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w"]+)/gi)) {
            columns.push([name(alter[1]), name(add[1])]);
        }
    }
    return { tables: [...tables], columns };
}

(async () => {
    const env = fs.readFileSync(path.join(__dirname, '../apps/api/.env'), 'utf8');
    const url = process.env.DATABASE_URL || env.match(/DATABASE_URL="?([^"\r\n]+)"?/)[1];
    const db = new Client({ connectionString: url, connectionTimeoutMillis: 15000 });
    await db.connect();
    try {
        const tables = new Set((await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map(row => row.table_name));
        const columns = new Set((await db.query("SELECT table_name || '.' || column_name AS key FROM information_schema.columns WHERE table_schema='public'")).rows.map(row => row.key));
        const files = fs.readdirSync(dir).filter(file => file.endsWith('.sql') && (!since || file >= since)).sort();
        const pending = [];
        for (const file of files) {
            const wanted = expectations(strip(fs.readFileSync(path.join(dir, file), 'utf8')));
            const missing = [
                ...wanted.tables.filter(table => !tables.has(table)).map(table => `tabel ${table}`),
                ...wanted.columns.filter(([table, column]) => tables.has(table) && !columns.has(`${table}.${column}`) &&
                    !wanted.tables.includes(table)).map(([table, column]) => `kolom ${table}.${column}`),
            ];
            if (missing.length) pending.push(file), console.log(`BELUM  ${file}\n       ${missing.join(', ')}`);
        }
        if (!pending.length) console.log(`OK     ${files.length} berkas migrasi: semua tabel dan kolom yang ditambahkan sudah ada.`);
        else {
            console.log(`\nTerapkan:\n  node tools/apply-migrations.js --files=${pending.join(',')} --confirm`);
            process.exitCode = 1;
        }
        console.log('\nCatatan: hanya penambahan tabel/kolom yang dapat diperiksa otomatis; trigger, indeks, dan constraint tidak.');
    } finally { await db.end(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
