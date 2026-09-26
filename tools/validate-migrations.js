#!/usr/bin/env node
/**
 * Validasi berkas migrasi tanpa mengubah database.
 *
 * Seluruh DDL dijalankan di dalam SATU transaksi yang selalu diakhiri ROLLBACK.
 * PostgreSQL menjalankan DDL secara transaksional, jadi tabel dan kolom benar
 * benar dibuat lalu diperiksa di dalam transaksi — yang diuji adalah DDL yang
 * BEKERJA, bukan sekadar lolos parser — kemudian semuanya dibatalkan.
 *
 *   DATABASE_URL="postgresql://…/acca_db" node tools/validate-migrations.js
 *
 * Catatan: ALTER TABLE mengambil ACCESS EXCLUSIVE LOCK. Kuncinya dilepas saat
 * ROLLBACK (milidetik), tetapi jangan dijalankan saat ujian sedang berlangsung.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'database', 'migrations');

const FILES = [
    '20260916_01_cbt_missing_tables.sql',
    '20260916_02_cbt_missing_columns.sql',
    '20260916_03_drop_fitur_produk_asal.sql',
    '20260925_01_add_updated_at_question_banks.sql',
    '20260926_01_unique_active_exam_attempt.sql',
    '20260926_02_offline_proctoring.sql',
    '20260926_03_single_school.sql',
];

/** Tabel yang harus ada setelah migrasi pertama. */
const EXPECTED_TABLES = [
    'platform_admins', 'acca_settings', 'school_years', 'bank_categories',
    'exam_classes', 'exam_configs', 'exam_config_banks', 'exam_config_exams',
];

/** Tabel yang harus SUDAH TIDAK ADA setelah migrasi ketiga. */
const EXPECTED_DROPPED_TABLES = [
    'cbt_payments', 'cbt_organization_subscriptions', 'cbt_subscription_plans',
    'cbt_payment_transactions', 'user_subscriptions', 'user_token_purchases',
    'cbt_role_permissions', 'cbt_permissions',
    'unelma_posts', 'unelma_post_categories', 'unelma_post_tags',
    'unelma_post_category_links', 'unelma_post_tag_links',
];

// cbt_token_transactions, cbt_unlocked_exams, token_balance, is_paid, dan
// token_price TIDAK ada di daftar ini: penghapusannya tertunda di berkas
// 20260916_04_*.TERTUNDA karena masih dirujuk kode acca-new.

/** Kolom yang harus SUDAH TIDAK ADA setelah migrasi ketiga. */
const EXPECTED_DROPPED_COLUMNS = [
    ['cbt_organizations', 'hero_image_url'],
];

/** Kolom yang harus ada setelah migrasi kedua. */
const EXPECTED_COLUMNS = [
    ['cbt_profiles', 'email'],
    ['cbt_profiles', 'unique_id'],
    ['cbt_profiles', 'role'],
    ['cbt_organization_members', 'role'],
    ['cbt_question_banks', 'updated_at'],
    ['bank_folders', 'updated_at'],
    ['cbt_exam_attempts', 'last_seen_at'],
];

const EXPECTED_INDEXES = [
    'cbt_exam_attempts_one_active_per_user_exam',
    'cbt_exam_attempts_active_last_seen',
    'cbt_security_logs_client_event_unique',
    'cbt_organizations_singleton',
];

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

/**
 * Buang BEGIN/COMMIT milik berkas migrasi.
 *
 * Transaksi pembungkus dikendalikan skrip ini. Membiarkan COMMIT di dalamnya
 * akan MENYIMPAN perubahan — persis yang harus dicegah di sini.
 */
function stripTransactionControl(sql) {
    return sql
        .split('\n')
        .filter((line) => !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/i.test(line))
        .join('\n');
}

(async () => {
    const { Client } = require('pg');
    const client = new Client({
        connectionString: resolveDatabaseUrl(),
        connectionTimeoutMillis: 20000,
    });
    await client.connect();

    const database = (await client.query('SELECT current_database() AS db')).rows[0].db;
    console.log(`=== VALIDASI MIGRASI (dry run) ===`);
    console.log(`database : ${database}`);
    console.log(`mode     : semua perubahan dibatalkan dengan ROLLBACK\n`);

    let failed = false;

    try {
        await client.query('BEGIN');
        // Lindungi dari kemacetan: kalau ada transaksi lain memegang kunci,
        // lebih baik gagal cepat daripada menahan aplikasi yang sedang berjalan.
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL statement_timeout = '120s'");

        for (const file of FILES) {
            const sql = stripTransactionControl(
                fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'),
            );
            process.stdout.write(`  ${file} … `);
            await client.query(sql);
            console.log('OK');
        }

        console.log('\n--- verifikasi di dalam transaksi ---');

        const tables = (await client.query(
            `SELECT table_name FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
            [EXPECTED_TABLES],
        )).rows.map((r) => r.table_name);

        const missingTables = EXPECTED_TABLES.filter((t) => !tables.includes(t));
        console.log(`  tabel terbentuk : ${tables.length}/${EXPECTED_TABLES.length}`);
        if (missingTables.length) {
            failed = true;
            console.log(`  TIDAK TERBENTUK : ${missingTables.join(', ')}`);
        }

        let columnsOk = 0;
        for (const [table, column] of EXPECTED_COLUMNS) {
            const { rowCount } = await client.query(
                `SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
                [table, column],
            );
            if (rowCount) columnsOk++;
            else {
                failed = true;
                console.log(`  TIDAK TERBENTUK : ${table}.${column}`);
            }
        }
        console.log(`  kolom terbentuk : ${columnsOk}/${EXPECTED_COLUMNS.length}`);

        const indexes = (await client.query(
            `SELECT indexname FROM pg_indexes
              WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
            [EXPECTED_INDEXES],
        )).rows.map((row) => row.indexname);
        const missingIndexes = EXPECTED_INDEXES.filter((name) => !indexes.includes(name));
        console.log(`  index terbentuk : ${indexes.length}/${EXPECTED_INDEXES.length}`);
        if (missingIndexes.length) {
            failed = true;
            console.log(`  TIDAK TERBENTUK : ${missingIndexes.join(', ')}`);
        }

        // Migrasi ketiga menghapus; yang diperiksa adalah KETIADAANNYA.
        const stillThere = (await client.query(
            `SELECT table_name FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
            [EXPECTED_DROPPED_TABLES],
        )).rows.map((r) => r.table_name);
        console.log(`  tabel terhapus  : ${EXPECTED_DROPPED_TABLES.length - stillThere.length}/${EXPECTED_DROPPED_TABLES.length}`);
        if (stillThere.length) {
            failed = true;
            console.log(`  MASIH ADA       : ${stillThere.join(', ')}`);
        }

        let droppedOk = 0;
        for (const [table, column] of EXPECTED_DROPPED_COLUMNS) {
            const { rowCount } = await client.query(
                `SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
                [table, column],
            );
            if (!rowCount) droppedOk++;
            else {
                failed = true;
                console.log(`  MASIH ADA       : ${table}.${column}`);
            }
        }
        console.log(`  kolom terhapus  : ${droppedOk}/${EXPECTED_DROPPED_COLUMNS.length}`);

        // Backfill email harus benar-benar mengisi data, bukan sekadar jalan.
        const backfilled = (await client.query(
            `SELECT COUNT(*)::int AS n FROM public.cbt_profiles WHERE email IS NOT NULL`,
        )).rows[0].n;
        console.log(`  email terisi    : ${backfilled} baris cbt_profiles`);

        // Idempotensi: menjalankan ulang tidak boleh melempar galat.
        process.stdout.write('  jalankan ulang  … ');
        for (const file of FILES) {
            await client.query(
                stripTransactionControl(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')),
            );
        }
        console.log('OK (idempoten)');
    } catch (error) {
        failed = true;
        console.log('GAGAL');
        console.error(`\n  ${error.message}`);
        if (error.position) console.error(`  posisi karakter: ${error.position}`);
        if (error.hint) console.error(`  petunjuk: ${error.hint}`);
    } finally {
        await client.query('ROLLBACK');
        console.log('\n--- ROLLBACK dijalankan ---');
    }

    // Buktikan tidak ada yang tersimpan.
    const leftover = (await client.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
        [EXPECTED_TABLES],
    )).rows.map((r) => r.table_name);

    if (leftover.length > 0) {
        console.log(`  PERINGATAN: tabel masih ada setelah rollback: ${leftover.join(', ')}`);
        console.log('  (berarti tabel itu memang sudah ada sebelum validasi dijalankan)');
    } else {
        console.log('  database tidak berubah — tidak ada tabel baru yang tersisa');
    }

    await client.end();
    console.log(failed ? '\nHASIL: GAGAL' : '\nHASIL: LOLOS');
    process.exit(failed ? 1 : 0);
})().catch((error) => {
    console.error('GAGAL:', error.message);
    process.exit(1);
});
