#!/usr/bin/env node
/**
 * Audit read-only keselarasan jadwal sumber dengan cbt_exams hasil generate.
 * Tidak menjalankan DDL/DML dan hanya mencetak hitungan, tanpa data pengguna.
 *
 *   DATABASE_URL="postgresql://..." node tools/audit-generated-exam-sync.js --expect-db=acca_db
 */
const { Client } = require('pg');

function databaseUrl() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL wajib diset eksplisit.');
    return process.env.DATABASE_URL;
}

function expectedDatabase() {
    const value = process.argv.find((arg) => arg.startsWith('--expect-db='))
        ?.slice('--expect-db='.length);
    if (!value) throw new Error('Sebutkan database tujuan dengan --expect-db=nama_database.');
    return value;
}

async function count(client, sql) {
    return Number((await client.query(sql)).rows[0]?.count || 0);
}

(async () => {
    const expected = expectedDatabase();
    const client = new Client({ connectionString: databaseUrl(), connectionTimeoutMillis: 20_000 });
    await client.connect();
    const actual = (await client.query('SELECT current_database() AS name')).rows[0].name;
    if (actual !== expected) throw new Error(`Database tujuan '${actual}' bukan '${expected}'.`);

    await client.query("SET statement_timeout = '30s'");
    await client.query('SET default_transaction_read_only = on');

    const checks = [
        ['konfigurasi: bank/mapel/durasi ujian berbeda', `
            SELECT COUNT(*)::int AS count
            FROM public.exam_config_exams schedule
            JOIN public.exam_config_banks bank ON bank.id = schedule.exam_config_bank_id
            JOIN public.cbt_exams exam ON exam.id = schedule.exam_id
            WHERE exam.question_bank_id IS DISTINCT FROM bank.bank_id
               OR exam.subject_id IS DISTINCT FROM bank.subject_id
               OR exam.duration_minutes IS DISTINCT FROM bank.duration_minutes
        `],
        ['konfigurasi: waktu ujian berbeda', `
            SELECT COUNT(*)::int AS count
            FROM public.exam_config_exams schedule
            JOIN public.cbt_exams exam ON exam.id = schedule.exam_id
            WHERE exam.start_time IS DISTINCT FROM
                    ((schedule.scheduled_date + schedule.scheduled_time) AT TIME ZONE 'Asia/Jakarta')
               OR exam.end_time IS DISTINCT FROM
                    ((schedule.scheduled_date + schedule.window_end_time) AT TIME ZONE 'Asia/Jakarta')
        `],
        ['konfigurasi: target kelas hilang', `
            SELECT COUNT(*)::int AS count
            FROM public.exam_config_exams schedule
            WHERE schedule.exam_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM public.cbt_exam_targets target
                WHERE target.exam_id = schedule.exam_id AND target.class_id = schedule.class_id
            )
        `],
        ['konfigurasi: metadata tautan berbeda', `
            SELECT COUNT(*)::int AS count
            FROM public.exam_config_exams schedule
            JOIN public.cbt_exams exam ON exam.id = schedule.exam_id
            WHERE exam.metadata->>'exam_config_id' IS DISTINCT FROM schedule.exam_config_id::text
               OR exam.metadata->>'exam_config_bank_id' IS DISTINCT FROM schedule.exam_config_bank_id::text
               OR exam.metadata->>'exam_config_exam_id' IS DISTINCT FROM schedule.id::text
        `],
        ['konfigurasi: perbedaan pada ujian yang sudah ber-riwayat', `
            WITH different AS (
                SELECT exam.id
                FROM public.exam_config_exams schedule
                JOIN public.exam_config_banks bank ON bank.id = schedule.exam_config_bank_id
                JOIN public.cbt_exams exam ON exam.id = schedule.exam_id
                WHERE exam.question_bank_id IS DISTINCT FROM bank.bank_id
                   OR exam.subject_id IS DISTINCT FROM bank.subject_id
                   OR exam.duration_minutes IS DISTINCT FROM bank.duration_minutes
            )
            SELECT COUNT(*)::int AS count FROM different
            WHERE EXISTS (SELECT 1 FROM public.cbt_exam_attempts a WHERE a.exam_id = different.id)
               OR EXISTS (SELECT 1 FROM public.cbt_certificates c WHERE c.exam_id = different.id)
        `],
        ['PAS: bank/mapel/durasi ujian berbeda', `
            SELECT COUNT(*)::int AS count
            FROM public.cbt_pas_class_schedules schedule
            JOIN public.cbt_exams exam ON exam.id = schedule.exam_id
            WHERE exam.question_bank_id IS DISTINCT FROM schedule.bank_id
               OR exam.subject_id IS DISTINCT FROM schedule.subject_id
               OR exam.duration_minutes IS DISTINCT FROM schedule.duration_minutes
        `],
        ['PAS: waktu ujian berbeda', `
            SELECT COUNT(*)::int AS count
            FROM public.cbt_pas_class_schedules schedule
            JOIN public.cbt_exams exam ON exam.id = schedule.exam_id
            WHERE exam.start_time IS DISTINCT FROM
                    ((schedule.scheduled_date + schedule.scheduled_time) AT TIME ZONE 'Asia/Jakarta')
               OR exam.end_time IS DISTINCT FROM
                    ((schedule.scheduled_date + COALESCE(schedule.window_end_time, schedule.scheduled_time)) AT TIME ZONE 'Asia/Jakarta')
        `],
        ['PAS: target kelas hilang', `
            SELECT COUNT(*)::int AS count
            FROM public.cbt_pas_class_schedules schedule
            WHERE schedule.exam_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM public.cbt_exam_targets target
                WHERE target.exam_id = schedule.exam_id AND target.class_id = schedule.class_id
            )
        `],
        ['PAS: metadata tautan berbeda', `
            SELECT COUNT(*)::int AS count
            FROM public.cbt_pas_class_schedules schedule
            JOIN public.cbt_exams exam ON exam.id = schedule.exam_id
            WHERE exam.metadata->>'pas_schedule_id' IS DISTINCT FROM schedule.id::text
        `],
    ];

    console.log('=== AUDIT READ-ONLY SINKRONISASI UJIAN HASIL GENERATE ===');
    console.log(`database : ${actual}`);
    let findings = 0;
    for (const [label, sql] of checks) {
        const value = await count(client, sql);
        findings += value;
        console.log(`${value > 0 ? 'TEMUAN' : 'OK'.padEnd(6)} ${label}: ${value}`);
    }
    await client.end();
    console.log(`HASIL: ${findings === 0 ? 'seluruh relasi selaras' : `${findings} baris perlu ditinjau`}.`);
    process.exit(findings > 0 ? 2 : 0);
})().catch((error) => {
    console.error(`AUDIT GAGAL: ${error.message}`);
    process.exit(1);
});

