#!/usr/bin/env node
/**
 * Audit read-only integritas lifecycle ujian pada PostgreSQL staging.
 * Tidak menjalankan DDL/DML dan tidak mencetak URL, kredensial, atau data siswa.
 *
 *   DATABASE_URL="postgresql://.../staging" node tools/audit-exam-lifecycle-db.js
 */

const { Client } = require('pg');

const REQUIRED_COLUMNS = [
    ['cbt_exam_attempts', 'last_seen_at'],
    ['cbt_question_banks', 'updated_at'],
    ['bank_folders', 'updated_at'],
];
const REQUIRED_INDEXES = [
    'cbt_exam_attempts_one_active_per_user_exam',
    'cbt_exam_attempts_active_last_seen',
    'cbt_security_logs_client_event_unique',
    'cbt_organizations_singleton',
];

function resolveDatabaseUrl() {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
    throw new Error('DATABASE_URL staging wajib diset eksplisit; file .env tidak dibaca otomatis.');
}

function expectedDatabase() {
    const value = process.argv.find(arg => arg.startsWith('--expect-db='))?.slice('--expect-db='.length);
    if (!value) throw new Error('Sebutkan nama database staging dengan --expect-db=nama_database.');
    return value;
}

async function scalar(client, sql) {
    const result = await client.query(sql);
    return Number(result.rows[0]?.count || 0);
}

(async () => {
    const expectedDb = expectedDatabase();
    const client = new Client({ connectionString: resolveDatabaseUrl(), connectionTimeoutMillis: 20_000 });
    await client.connect();
    const identity = (await client.query(
        'SELECT current_database() AS database, current_user AS role, pg_is_in_recovery() AS replica',
    )).rows[0];
    if (identity.database !== expectedDb) {
        await client.end();
        throw new Error(`Database tujuan '${identity.database}' tidak sama dengan --expect-db='${expectedDb}'.`);
    }
    await client.query("SET statement_timeout = '30s'");
    await client.query("SET default_transaction_read_only = on");
    console.log('=== AUDIT READ-ONLY LIFECYCLE UJIAN ===');
    console.log(`database : ${identity.database}`);
    console.log(`role     : ${identity.role}`);
    console.log(`replica  : ${identity.replica ? 'ya' : 'tidak'}`);

    let blockers = 0;
    let warnings = 0;
    const report = (severity, label, count) => {
        console.log(`${severity.padEnd(8)} ${label}: ${count}`);
        if (count > 0 && severity === 'BLOCKER') blockers += 1;
        if (count > 0 && severity === 'WARNING') warnings += 1;
    };

    for (const [table, column] of REQUIRED_COLUMNS) {
        const result = await client.query(
            `SELECT COUNT(*)::int AS count FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
            [table, column],
        );
        report('BLOCKER', `kolom hilang ${table}.${column}`, result.rows[0].count ? 0 : 1);
    }

    const installedIndexes = (await client.query(
        `SELECT indexname FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
        [REQUIRED_INDEXES],
    )).rows.map(row => row.indexname);
    for (const index of REQUIRED_INDEXES) {
        report('BLOCKER', `index hilang ${index}`, installedIndexes.includes(index) ? 0 : 1);
    }

    const schoolCount = await scalar(client, `
        SELECT COUNT(*)::int AS count FROM public.cbt_organizations
    `);
    report('BLOCKER', 'jumlah sekolah selain satu', schoolCount === 1 ? 0 : schoolCount || 1);

    report('BLOCKER', 'pasangan ujian/siswa dengan attempt aktif ganda', await scalar(client, `
        SELECT COUNT(*)::int AS count FROM (
          SELECT exam_id, user_id FROM public.cbt_exam_attempts
          WHERE status = 'in_progress' GROUP BY exam_id, user_id HAVING COUNT(*) > 1
        ) duplicate_active
    `));
    report('BLOCKER', 'pasangan attempt/soal dengan jawaban ganda', await scalar(client, `
        SELECT COUNT(*)::int AS count FROM (
          SELECT attempt_id, question_id FROM public.cbt_answers
          GROUP BY attempt_id, question_id HAVING COUNT(*) > 1
        ) duplicate_answers
    `));
    report('BLOCKER', 'client_event_id pengawasan ganda', await scalar(client, `
        SELECT COUNT(*)::int AS count FROM (
          SELECT attempt_id, metadata->>'client_event_id' AS event_id
          FROM public.cbt_attempt_security_logs WHERE metadata ? 'client_event_id'
          GROUP BY attempt_id, metadata->>'client_event_id' HAVING COUNT(*) > 1
        ) duplicate_events
    `));
    report('BLOCKER', 'jawaban tanpa attempt', await scalar(client, `
        SELECT COUNT(*)::int AS count FROM public.cbt_answers answer
        LEFT JOIN public.cbt_exam_attempts attempt ON attempt.id = answer.attempt_id
        WHERE attempt.id IS NULL
    `));
    report('BLOCKER', 'jawaban tanpa soal', await scalar(client, `
        SELECT COUNT(*)::int AS count FROM public.cbt_answers answer
        LEFT JOIN public.cbt_bank_questions question ON question.id = answer.question_id
        WHERE question.id IS NULL
    `));
    report('BLOCKER', 'pilihan jawaban tanpa opsi', await scalar(client, `
        SELECT COUNT(*)::int AS count FROM public.cbt_answers answer
        LEFT JOIN public.cbt_bank_question_options option_row ON option_row.id = answer.selected_option_id
        WHERE answer.selected_option_id IS NOT NULL AND option_row.id IS NULL
    `));
    report('WARNING', 'attempt aktif tanpa kunci perangkat', await scalar(client, `
        SELECT COUNT(*)::int AS count FROM public.cbt_exam_attempts
        WHERE status = 'in_progress' AND NULLIF(BTRIM(device_fingerprint), '') IS NULL
    `));
    report('WARNING', 'attempt aktif tanpa dasar deadline', await scalar(client, `
        SELECT COUNT(*)::int AS count FROM public.cbt_exam_attempts
        WHERE status = 'in_progress' AND personal_end_time IS NULL AND started_at IS NULL
    `));
    report('WARNING', 'attempt final tanpa finished_at', await scalar(client, `
        SELECT COUNT(*)::int AS count FROM public.cbt_exam_attempts
        WHERE status IN ('submitted', 'auto_submitted') AND finished_at IS NULL
    `));
    report('WARNING', 'attempt final tanpa total_score', await scalar(client, `
        SELECT COUNT(*)::int AS count FROM public.cbt_exam_attempts
        WHERE status IN ('submitted', 'auto_submitted') AND total_score IS NULL
    `));

    await client.end();
    console.log(`HASIL: ${blockers ? `${blockers} kelompok blocker` : 'tanpa blocker'}; ${warnings} kelompok warning.`);
    process.exit(blockers ? 2 : 0);
})().catch(error => {
    console.error(`AUDIT GAGAL: ${error.message}`);
    process.exit(1);
});
