// Pemeriksaan baca-saja: apakah migrasi 20261023_01..03 sudah diterapkan. Tidak mengubah apa pun.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
(async () => {
    const env = fs.readFileSync(path.join(__dirname, '../apps/api/.env'), 'utf8');
    const url = process.env.DATABASE_URL || env.match(/DATABASE_URL="?([^"\r\n]+)"?/)[1];
    const db = new Client({ connectionString: url, connectionTimeoutMillis: 15000 });
    await db.connect();
    try {
        const one = async (sql) => (await db.query(sql)).rows;
        const invigilatorDate = (await one("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cbt_pas_room_invigilators' AND column_name='exam_date'")).length === 1;
        const tables = (await one("SELECT relname FROM pg_class WHERE relname IN ('cbt_bank_collaborators','cbt_exam_collaborators','cbt_collaboration_events')")).length;
        const triggers = (await one("SELECT tgname FROM pg_trigger WHERE tgname IN ('cbt_exams_collaboration_version','cbt_banks_collaboration_version')")).map(row => row.tgname);
        const report = [
            ['20261023_01 pengawas per tanggal (kolom exam_date)', invigilatorDate],
            ['20261023_02 tabel kolaborator (3 tabel)', tables === 3],
            ['20261023_02 pemicu versi bank soal', triggers.includes('cbt_banks_collaboration_version')],
            ['20261023_03 pemicu versi ujian sudah dihapus', !triggers.includes('cbt_exams_collaboration_version')],
        ];
        for (const [label, ok] of report) console.log(`${ok ? 'OK   ' : 'BELUM'}  ${label}`);
        if (report.some(([, ok]) => !ok)) process.exitCode = 1;
    } finally { await db.end(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
