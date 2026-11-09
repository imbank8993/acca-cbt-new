/* eslint-disable no-console */
/**
 * Pindahkan gambar base64 yang tertanam di soal ke penyimpanan (Cloudflare R2).
 *
 * Dijalankan DI DALAM kontainer API (lewat tools/vps/pindahkan-gambar-base64.sh),
 * karena hanya di sana DATABASE_URL dan kredensial R2 tersedia:
 *
 *   node - cek                          hanya membaca: di mana base64 berada dan seberapa besar
 *   node - jalankan --cadangan <file>   unggah gambar, ganti dengan URL, simpan cadangan per baris
 *   node - pulihkan <file>              kembalikan nilai asli dari cadangan
 *
 * Hasil pemindahan sama dengan gambar yang diunggah lewat editor soal:
 *   <NEXT_PUBLIC_SITE_URL>/api/storage/file/banks/<bank>/images/img_<sha256>.<ext>
 * Nama berkas berasal dari isi gambar, jadi menjalankan ulang tidak menggandakan
 * berkas, dan gambar yang sama di banyak soal satu bank cukup disimpan sekali.
 *
 * Yang dipindahkan: bank soal, opsi, stimulus, petunjuk, dan salinan soal ujian
 * (cbt_exam_question_snapshots). Salinan ujian WAJIB ikut: siswa hanya boleh
 * membuka berkas yang URL-nya tercantum di salinan soal ujiannya. Tabel lain
 * hanya dilaporkan.
 */
'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

const DATA_IMAGE = /data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})/gi;
const EXT = { png: 'png', jpeg: 'jpg', jpg: 'jpg', pjpeg: 'jpg', gif: 'gif', webp: 'webp', bmp: 'bmp', 'svg+xml': 'svg' };
const MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' };
const NAME = /^[a-z_][a-z0-9_]*$/;
const BATCH = 25;

/** Tabel yang dipindahkan dan cara menemukan bank soal tiap baris. */
const TARGETS = [
    { table: 'cbt_bank_questions', bank: 't.bank_id' },
    { table: 'cbt_bank_question_options', bank: '(SELECT q.bank_id FROM public.cbt_bank_questions q WHERE q.id = t.question_id)' },
    { table: 'cbt_question_stimuli', bank: 't.bank_id' },
    { table: 'cbt_question_instructions', bank: 't.bank_id' },
    { table: 'cbt_exam_question_snapshots', bank: "coalesce(t.question_snapshot->>'bank_id', (SELECT e.question_bank_id::text FROM public.cbt_exams e WHERE e.id = t.exam_id))", examLock: 't.exam_id' },
];

// ─── Akses basis data: pg bila ada (tes), selain itu Prisma (kontainer API) ───
async function openDb() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL tidak tersedia di lingkungan ini.');
    let pg = null;
    try { pg = require('pg'); } catch { /* kontainer produksi: pakai Prisma */ }
    if (pg) {
        // Parameter khusus Prisma tidak dikenal pg.
        const parsed = new URL(url);
        for (const name of ['schema', 'connection_limit', 'pool_timeout']) parsed.searchParams.delete(name);
        const pool = new pg.Pool({ connectionString: parsed.toString(), max: 2 });
        const wrap = (client) => ({ query: async (sql, params = []) => (await client.query(sql, params)).rows });
        return {
            ...wrap(pool),
            async tx(fn) {
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    const result = await fn(wrap(client));
                    await client.query('COMMIT');
                    return result;
                } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
            },
            close: () => pool.end(),
        };
    }
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient({ datasourceUrl: url });
    const wrap = (client) => ({ query: (sql, params = []) => client.$queryRawUnsafe(sql, ...params) });
    return {
        ...wrap(prisma),
        tx: (fn) => prisma.$transaction(tx => fn(wrap(tx)), { maxWait: 20_000, timeout: 120_000 }),
        close: () => prisma.$disconnect(),
    };
}

// ─── Penyimpanan: R2, atau folder lokal untuk tes (GAMBAR_UNGGAH_KE_FOLDER) ───
function openStorage() {
    const localDir = process.env.GAMBAR_UNGGAH_KE_FOLDER;
    if (localDir) {
        return {
            async exists(key) { return fs.existsSync(`${localDir}/${key}`); },
            async put(key, body) {
                fs.mkdirSync(`${localDir}/${key.split('/').slice(0, -1).join('/')}`, { recursive: true });
                fs.writeFileSync(`${localDir}/${key}`, body);
            },
        };
    }
    const need = ['CLOUDFLARE_R2_ACCOUNT_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_R2_BUCKET_NAME'];
    const missing = need.filter(name => !process.env[name]);
    if (missing.length) throw new Error(`Kredensial R2 belum lengkap: ${missing.join(', ')}`);
    const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
    const client = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID, secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY },
    });
    const Bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME;
    return {
        async exists(key) {
            try { await client.send(new HeadObjectCommand({ Bucket, Key: key })); return true; } catch (error) {
                if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return false;
                throw error;
            }
        },
        async put(key, body, contentType) {
            await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
        },
    };
}

// ─── Utilitas ───
const mb = (bytes) => Number(bytes) < 1024 * 1024
    ? `${Math.max(1, Math.round(Number(bytes) / 1024))} KB` : `${(Number(bytes) / (1024 * 1024)).toFixed(1)} MB`;
const subtypeOf = (dataUrl) => dataUrl.slice('data:image/'.length, dataUrl.indexOf(';')).toLowerCase();
const quote = (name) => { if (!NAME.test(name)) throw new Error(`Nama tidak aman: ${name}`); return `"${name}"`; };

function siteOrigin() {
    const raw = (process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
    return /^https?:\/\/[^/]+$/i.test(raw) ? raw : '';
}

async function textColumns(db, table) {
    const rows = await db.query(
        `SELECT column_name::text AS column_name, data_type::text AS data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND data_type IN ('text', 'character varying', 'json', 'jsonb')
         ORDER BY ordinal_position`, [table]);
    return rows.filter(row => NAME.test(row.column_name));
}

async function primaryKey(db, table) {
    const rows = await db.query(
        `SELECT a.attname::text AS attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
         WHERE i.indrelid = $1::regclass AND i.indisprimary`, [`public.${table}`]);
    return rows.length === 1 ? rows[0].attname : null;
}

async function tableExists(db, table) {
    const rows = await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${table}`]);
    return rows[0]?.ok === true;
}

// ─── cek ───
async function cek(db) {
    const rows = await db.query(
        `SELECT c.table_name::text AS table_name, c.column_name::text AS column_name, c.data_type::text AS data_type FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
           AND c.data_type IN ('text', 'character varying', 'json', 'jsonb')
         ORDER BY c.table_name, c.ordinal_position`);
    const migratable = new Set(TARGETS.map(target => target.table));
    const found = [];
    for (const { table_name: table, column_name: column } of rows) {
        if (!NAME.test(table) || !NAME.test(column)) continue;
        try {
            const [stat] = await db.query(
                `SELECT count(*)::int AS rows, coalesce(sum(length(${quote(column)}::text)), 0)::bigint AS bytes
                 FROM public.${quote(table)} WHERE ${quote(column)}::text LIKE '%data:image/%'`);
            if (stat.rows > 0) found.push({ table, column, rows: stat.rows, bytes: Number(stat.bytes) });
        } catch (error) {
            console.log(`  ! ${table}.${column} dilewati: ${error.message}`);
        }
    }
    if (!found.length) {
        console.log('Tidak ada gambar base64 di database. Tidak ada yang perlu dipindahkan.');
        return;
    }
    let images = 0, unsupported = 0, total = 0;
    console.log('Kolom yang berisi gambar base64:\n');
    console.log('  TABEL.KOLOM                                         BARIS     UKURAN   STATUS');
    for (const item of found) {
        total += item.bytes;
        const status = migratable.has(item.table) ? 'akan dipindah' : 'hanya dilaporkan';
        console.log(`  ${`${item.table}.${item.column}`.padEnd(50)} ${String(item.rows).padStart(6)} ${mb(item.bytes).padStart(10)}   ${status}`);
        if (!migratable.has(item.table)) continue;
        for (let last = ''; ;) {
            const batch = await db.query(
                `SELECT ctid::text AS cursor, ${quote(item.column)}::text AS value FROM public.${quote(item.table)}
                 WHERE ${quote(item.column)}::text LIKE '%data:image/%' AND ctid::text > $1 ORDER BY ctid::text LIMIT ${BATCH}`, [last]);
            if (!batch.length) break;
            for (const row of batch) {
                for (const match of row.value.matchAll(DATA_IMAGE)) {
                    images++;
                    if (!EXT[subtypeOf(match[0])]) unsupported++;
                }
            }
            last = batch[batch.length - 1].cursor;
        }
    }
    console.log(`\nTotal ukuran kolom berisi base64: ${mb(total)}`);
    console.log(`Gambar di tabel yang akan dipindah: ${images} (termasuk duplikat)`);
    if (unsupported) console.log(`  ${unsupported} di antaranya EMF/WMF/format lain yang tidak bisa ditampilkan browser: dibiarkan apa adanya.`);
    const [{ running }] = await db.query(`SELECT count(*)::int AS running FROM public.cbt_exam_attempts WHERE status = 'in_progress'`);
    console.log(running
        ? `\nPerhatian: ${running} pengerjaan ujian sedang berlangsung. Jalankan pemindahan setelah ujian selesai.`
        : '\nTidak ada ujian yang sedang berlangsung.');
    console.log(`Alamat situs untuk URL gambar: ${siteOrigin() || '(NEXT_PUBLIC_SITE_URL kosong → URL relatif /api/storage/file/...)'}`);
}

// ─── jalankan ───
async function jalankan(db, storage, backupPath, force) {
    if (!backupPath) throw new Error('Wajib: --cadangan <file>');
    const [{ running }] = await db.query(`SELECT count(*)::int AS running FROM public.cbt_exam_attempts WHERE status = 'in_progress'`);
    if (running && !force) {
        throw new Error(`${running} pengerjaan ujian sedang berlangsung. Jalankan setelah ujian selesai (atau --paksa).`);
    }
    const backup = fs.openSync(backupPath, 'a');
    const origin = siteOrigin();
    const uploaded = new Map(); // key -> Promise
    const stats = { rows: 0, images: 0, files: 0, reused: 0, unsupported: 0, skipped: 0, before: 0, after: 0 };

    const ensureUploaded = (key, body, contentType) => {
        if (!uploaded.has(key)) {
            uploaded.set(key, (async () => {
                if (await storage.exists(key)) { stats.reused++; return; }
                await storage.put(key, body, contentType);
                stats.files++;
            })());
        }
        return uploaded.get(key);
    };

    for (const target of TARGETS) {
        if (!(await tableExists(db, target.table))) continue;
        const pk = await primaryKey(db, target.table);
        if (!pk) { console.log(`  ! ${target.table}: tidak punya primary key tunggal, dilewati.`); continue; }
        for (const { column_name: column, data_type: type } of await textColumns(db, target.table)) {
            const cast = type === 'jsonb' ? '::jsonb' : type === 'json' ? '::json' : '';
            let rowsInColumn = 0;
            for (let last = ''; ;) {
                const rows = await db.query(
                    `SELECT t.${quote(pk)}::text AS id, (${target.bank})::text AS bank_id,
                            ${target.examLock ? `(${target.examLock})::text` : 'NULL'} AS exam_id,
                            t.${quote(column)}::text AS value, md5(t.${quote(column)}::text) AS hash
                     FROM public.${quote(target.table)} t
                     WHERE t.${quote(column)}::text LIKE '%data:image/%' AND t.${quote(pk)}::text > $1
                     ORDER BY t.${quote(pk)}::text LIMIT ${BATCH}`, [last]);
                if (!rows.length) break;
                last = rows[rows.length - 1].id;
                for (const row of rows) {
                    const replacements = new Map();
                    for (const match of row.value.matchAll(DATA_IMAGE)) {
                        const dataUrl = match[0];
                        if (replacements.has(dataUrl)) continue;
                        const ext = EXT[subtypeOf(dataUrl)];
                        if (!ext) { stats.unsupported++; continue; }
                        const body = Buffer.from(match[2], 'base64');
                        const sha = crypto.createHash('sha256').update(body).digest('hex').slice(0, 32);
                        const folder = /^[0-9a-f-]{36}$/i.test(row.bank_id || '') ? `banks/${row.bank_id.toLowerCase()}/images` : 'banks/tanpa-bank/images';
                        const key = `${folder}/img_${sha}.${ext}`;
                        await ensureUploaded(key, body, MIME[ext]);
                        replacements.set(dataUrl, `${origin}/api/storage/file/${key}`);
                        stats.images++;
                    }
                    if (!replacements.size) continue;
                    const next = row.value.replace(DATA_IMAGE, match => replacements.get(match) ?? match);
                    if (cast) JSON.parse(next); // jangan pernah menulis JSON rusak
                    // Cadangan ditulis SEBELUM baris diubah.
                    fs.writeSync(backup, `${JSON.stringify({ table: target.table, pk, id: row.id, column, type, value: row.value })}\n`);
                    const changed = await db.tx(async tx => {
                        if (row.exam_id) {
                            // Kunci yang sama dengan koreksi kunci/revisi soal: penilaian tidak berjalan di tengah perubahan.
                            await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))::text AS locked`, [`exam-key-correction:${row.exam_id}`]);
                        }
                        const result = await tx.query(
                            `UPDATE public.${quote(target.table)} SET ${quote(column)} = $1${cast}
                             WHERE ${quote(pk)}::text = $2 AND md5(${quote(column)}::text) = $3 RETURNING 1 AS ok`,
                            [next, row.id, row.hash]);
                        return result.length;
                    });
                    if (!changed) { stats.skipped++; continue; }
                    stats.rows++; rowsInColumn++;
                    stats.before += row.value.length; stats.after += next.length;
                }
            }
            if (rowsInColumn) console.log(`  ✔ ${target.table}.${column}: ${rowsInColumn} baris`);
        }
    }
    fs.closeSync(backup);
    console.log(`\nSelesai: ${stats.rows} baris diperbarui, ${stats.images} gambar diganti URL.`);
    console.log(`Berkas baru diunggah: ${stats.files}; sudah ada sebelumnya: ${stats.reused}.`);
    console.log(`Ukuran kolom: ${mb(stats.before)} → ${mb(stats.after)}.`);
    if (stats.unsupported) console.log(`${stats.unsupported} gambar EMF/WMF/format lain dibiarkan (tidak bisa ditampilkan browser).`);
    if (stats.skipped) console.log(`${stats.skipped} baris berubah saat proses berjalan dan dilewati; jalankan ulang untuk menyelesaikannya.`);
}

// ─── pulihkan ───
async function pulihkan(db, backupPath) {
    if (!backupPath || !fs.existsSync(backupPath)) throw new Error(`File cadangan tidak ditemukan: ${backupPath}`);
    const lines = fs.readFileSync(backupPath, 'utf8').split('\n').filter(Boolean);
    let restored = 0;
    // Urutan terbalik: bila satu baris tercatat dua kali, nilai paling awal yang menang.
    for (const line of lines.reverse()) {
        const item = JSON.parse(line);
        const cast = item.type === 'jsonb' ? '::jsonb' : item.type === 'json' ? '::json' : '';
        const rows = await db.query(
            `UPDATE public.${quote(item.table)} SET ${quote(item.column)} = $1${cast} WHERE ${quote(item.pk)}::text = $2 RETURNING 1 AS ok`,
            [item.value, item.id]);
        restored += rows.length;
    }
    console.log(`Dipulihkan: ${restored} dari ${lines.length} baris tercatat.`);
}

async function main() {
    const args = process.argv.slice(2).filter(arg => arg !== '-');
    const command = args[0] || 'cek';
    const option = (name) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : undefined; };
    const db = await openDb();
    try {
        if (command === 'cek') await cek(db);
        else if (command === 'jalankan') await jalankan(db, openStorage(), option('--cadangan'), args.includes('--paksa'));
        else if (command === 'pulihkan') await pulihkan(db, args[1]);
        else throw new Error(`Perintah tidak dikenal: ${command}`);
    } finally {
        await db.close();
    }
}

main().catch(error => {
    console.error(`Galat: ${error.message}`);
    process.exitCode = 1;
});
