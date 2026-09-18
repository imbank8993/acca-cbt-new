#!/usr/bin/env node
/**
 * Terapkan berkas migrasi ke database — PERMANEN.
 *
 * Berbeda dengan `validate-migrations.js` yang selalu ROLLBACK, alat ini
 * MENYIMPAN perubahan. Karena itu ia menuntut dua hal secara eksplisit:
 *
 *   1. berkas yang dijalankan disebut satu per satu, dan
 *   2. `--confirm` disertakan.
 *
 * Berkas yang memuat DROP TABLE atau DROP COLUMN ditolak kecuali
 * `--allow-destructive` juga disertakan. Menambah kolom bisa dibatalkan;
 * menghapus tabel tidak.
 *
 *   node tools/apply-migrations.js --files=20260916_01_...,20260916_02_... --confirm
 *
 * Seluruh berkas dijalankan dalam SATU transaksi: kalau salah satu gagal,
 * tidak ada yang tersimpan.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'database', 'migrations');

function arg(name) {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
}
const has = (name) => process.argv.includes(`--${name}`);

function resolveDatabaseUrl() {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
    const envPath = path.join(ROOT, 'apps', 'api', '.env');
    const match = fs.existsSync(envPath)
        ? fs.readFileSync(envPath, 'utf8').match(/DATABASE_URL="?([^"\n]+)"?/)
        : null;
    if (!match) {
        console.error('DATABASE_URL tidak diset dan tidak ditemukan di apps/api/.env.');
        process.exit(1);
    }
    return match[1];
}

/** Sembunyikan kata sandi saat menampilkan tujuan koneksi. */
function maskUrl(url) {
    return url.replace(/(:\/\/[^:]+:)[^@]*@/, '$1****@');
}

(async () => {
    const list = arg('files');
    if (!list) {
        console.error('Sebutkan berkasnya: --files=nama1.sql,nama2.sql');
        process.exit(1);
    }

    const files = list.split(',').map((f) => f.trim()).filter(Boolean)
        .map((f) => (f.endsWith('.sql') ? f : `${f}.sql`));

    const sources = [];
    for (const file of files) {
        const full = path.join(MIGRATIONS_DIR, file);
        if (!fs.existsSync(full)) {
            console.error(`Berkas tidak ditemukan: ${file}`);
            process.exit(1);
        }
        sources.push({ file, sql: fs.readFileSync(full, 'utf8') });
    }

    const destructive = sources.filter((s) => /DROP\s+(TABLE|COLUMN)/i.test(s.sql));
    if (destructive.length > 0 && !has('allow-destructive')) {
        console.error('Berkas berikut memuat DROP dan ditolak tanpa --allow-destructive:');
        destructive.forEach((s) => console.error(`  ${s.file}`));
        process.exit(1);
    }

    const url = resolveDatabaseUrl();
    console.log('=== TERAPKAN MIGRASI (PERMANEN) ===');
    console.log(`tujuan : ${maskUrl(url)}`);
    console.log('berkas :');
    sources.forEach((s) => console.log(`  ${s.file}${/DROP\s+(TABLE|COLUMN)/i.test(s.sql) ? '  [DESTRUKTIF]' : ''}`));

    if (!has('confirm')) {
        console.log('\nTidak dijalankan. Tambahkan --confirm untuk benar-benar menerapkan.');
        process.exit(0);
    }

    const { Client } = require('pg');
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 20000 });
    await client.connect();

    const db = (await client.query('SELECT current_database() AS db')).rows[0].db;
    console.log(`\ndatabase: ${db}`);

    try {
        await client.query('BEGIN');
        // Gagal cepat daripada menahan aplikasi yang sedang melayani permintaan.
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '300s'");

        for (const { file, sql } of sources) {
            process.stdout.write(`  ${file} … `);
            // Kontrol transaksi milik berkas dibuang; transaksinya dikendalikan
            // di sini supaya kegagalan satu berkas membatalkan seluruhnya.
            const body = sql
                .split('\n')
                .filter((line) => !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/i.test(line))
                .join('\n');
            await client.query(body);
            console.log('OK');
        }

        await client.query('COMMIT');
        console.log('\nCOMMIT — perubahan tersimpan.');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`\nGAGAL: ${error.message}`);
        if (error.hint) console.error(`petunjuk: ${error.hint}`);
        console.error('ROLLBACK — tidak ada perubahan yang tersimpan.');
        await client.end();
        process.exit(1);
    }

    await client.end();
})().catch((error) => {
    console.error('GAGAL:', error.message);
    process.exit(1);
});
