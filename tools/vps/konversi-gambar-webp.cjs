/* eslint-disable no-console */
/**
 * Konversi gambar soal LAMA ke WebP (sisi terpanjang ≤1600 px), lalu ganti alamatnya di database.
 *
 * Dijalankan lewat tools/vps/konversi-gambar-webp.sh, yang memilih tempat menjalankannya
 * (kontainer API bila punya `sharp`, atau kontainer Node sementara):
 *
 *   node - cek                          hanya membaca: jumlah, ukuran, perkiraan penghematan
 *   node - jalankan --cadangan <file>   konversi, unggah berkas baru, ganti alamat, simpan cadangan per baris
 *   node - pulihkan <file>              kembalikan alamat lama dari cadangan
 *
 * Aturan sama dengan unggahan baru (apps/web/lib/question-image-optimize.ts): foto WebP 85%,
 * PNG/diagram 92%, transparansi & orientasi EXIF dipertahankan. SVG, GIF, WebP, gambar
 * beranimasi, dan hasil yang tidak lebih kecil dibiarkan.
 *
 * Berkas baru: <kunci-lama>.webp (mis. users/u1/questions/123_ab.jpg.webp) di folder yang sama,
 * sehingga aturan akses tidak berubah dan menjalankan ulang tidak menggandakan berkas.
 * Berkas LAMA TIDAK DIHAPUS, jadi `pulihkan` selalu aman.
 *
 * Yang diubah: bank soal, opsi, stimulus, petunjuk, dan salinan soal ujian (siswa hanya boleh
 * membuka berkas yang tercantum di salinan soal ujiannya).
 */
'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

const MAX_SIDE = 1600;
const PHOTO_QUALITY = 85;
const GRAPHIC_QUALITY = 92;
const ELIGIBLE = /\.(png|jpe?g|bmp)$/i;
const NAME = /^[a-z_][a-z0-9_]*$/;
const BATCH = 25;
const TARGETS = [
    { table: 'cbt_bank_questions' },
    { table: 'cbt_bank_question_options' },
    { table: 'cbt_question_stimuli' },
    { table: 'cbt_question_instructions' },
    { table: 'cbt_exam_question_snapshots', examLock: 't.exam_id' },
];

// ─── Basis data: pg bila ada (kontainer sementara/tes), selain itu Prisma (kontainer API) ───
async function openDb() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL tidak tersedia di lingkungan ini.');
    let pg = null;
    try { pg = require('pg'); } catch { /* kontainer API: pakai Prisma */ }
    if (pg) {
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
        const file = (key) => `${localDir}/${key}`;
        return {
            async size(key) { try { return fs.statSync(file(key)).size; } catch { return null; } },
            async get(key) { try { return fs.readFileSync(file(key)); } catch { return null; } },
            async exists(key) { return fs.existsSync(file(key)); },
            async put(key, body) {
                fs.mkdirSync(file(key).split('/').slice(0, -1).join('/'), { recursive: true });
                fs.writeFileSync(file(key), body);
            },
        };
    }
    const need = ['CLOUDFLARE_R2_ACCOUNT_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_R2_BUCKET_NAME'];
    const missing = need.filter(name => !process.env[name]);
    if (missing.length) throw new Error(`Kredensial R2 belum lengkap: ${missing.join(', ')}`);
    const { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
    const client = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID, secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY },
    });
    const Bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME;
    const notFound = (error) => error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey';
    return {
        async size(key) {
            try { return Number((await client.send(new HeadObjectCommand({ Bucket, Key: key }))).ContentLength ?? 0); }
            catch (error) { if (notFound(error)) return null; throw error; }
        },
        async get(key) {
            try {
                const response = await client.send(new GetObjectCommand({ Bucket, Key: key }));
                return Buffer.from(await response.Body.transformToByteArray());
            } catch (error) { if (notFound(error)) return null; throw error; }
        },
        async exists(key) { return (await this.size(key)) !== null; },
        async put(key, body, contentType) {
            await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
        },
    };
}

function loadSharp() {
    try { return require('sharp'); } catch { return null; }
}

// ─── Alamat gambar ───
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Pola alamat berkas: <origin>/api/storage/file/<kunci> atau <CLOUDFLARE_R2_PUBLIC_URL>/<kunci>. */
function storageUrlPattern() {
    const publicUrl = (process.env.CLOUDFLARE_R2_PUBLIC_URL || '').trim().replace(/\/+$/, '');
    // Garis miring terbalik diakhiri: di dalam JSON, kutip ditulis \" sehingga \ bukan bagian kunci.
    const parts = ['((?:https?:\\/\\/[^\\s"\'<>()\\\\]+?)?\\/api\\/storage\\/file\\/)([^\\s"\'<>()?#\\\\]+)'];
    if (/^https?:\/\//i.test(publicUrl)) parts.push(`(${escapeRegex(publicUrl)}\\/)([^\\s"'<>()?#\\\\]+)`);
    return new RegExp(parts.join('|'), 'gi');
}

function decodeKey(raw) {
    try { return raw.split('/').map(decodeURIComponent).join('/'); } catch { return raw; }
}
const encodeKey = (key) => key.split('/').map(encodeURIComponent).join('/');

function* storageRefs(text) {
    for (const match of text.matchAll(storageUrlPattern())) {
        const prefix = match[1] ?? match[3];
        const raw = match[2] ?? match[4];
        yield { full: match[0], prefix, key: decodeKey(raw) };
    }
}

function isAnimated(bytes, key) {
    const marker = /\.png$/i.test(key) ? 'acTL' : '';
    if (!marker) return false;
    return bytes.subarray(0, 4096).includes(Buffer.from(marker));
}

const mb = (bytes) => Number(bytes) < 1024 * 1024
    ? `${Math.max(1, Math.round(Number(bytes) / 1024))} KB` : `${(Number(bytes) / (1024 * 1024)).toFixed(1)} MB`;
const quote = (name) => { if (!NAME.test(name)) throw new Error(`Nama tidak aman: ${name}`); return `"${name}"`; };

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
    const rows = await db.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${table}`]);
    return rows[0]?.ok === true;
}

/** Telusuri baris di tabel sasaran yang memuat alamat berkas; panggil visit untuk tiap baris. */
async function eachReferencingRow(db, visit) {
    const publicUrl = (process.env.CLOUDFLARE_R2_PUBLIC_URL || '').trim().replace(/\/+$/, '');
    const needles = ['%/api/storage/file/%', ...(publicUrl ? [`%${publicUrl}/%`] : [])];
    for (const target of TARGETS) {
        if (!(await tableExists(db, target.table))) continue;
        const pk = await primaryKey(db, target.table);
        if (!pk) { console.log(`  ! ${target.table}: tidak punya primary key tunggal, dilewati.`); continue; }
        for (const { column_name: column, data_type: type } of await textColumns(db, target.table)) {
            const like = needles.map((_, i) => `t.${quote(column)}::text LIKE $${i + 2}`).join(' OR ');
            for (let last = ''; ;) {
                const rows = await db.query(
                    `SELECT t.${quote(pk)}::text AS id, ${target.examLock ? `(${target.examLock})::text` : 'NULL'} AS exam_id,
                            t.${quote(column)}::text AS value, md5(t.${quote(column)}::text) AS hash
                     FROM public.${quote(target.table)} t
                     WHERE (${like}) AND t.${quote(pk)}::text > $1
                     ORDER BY t.${quote(pk)}::text LIMIT ${BATCH}`, [last, ...needles]);
                if (!rows.length) break;
                last = rows[rows.length - 1].id;
                for (const row of rows) await visit({ target, pk, column, type, row });
            }
        }
    }
}

async function collectKeys(db) {
    const keys = new Map(); // key -> jumlah rujukan
    let rows = 0;
    await eachReferencingRow(db, async ({ row }) => {
        rows++;
        for (const ref of storageRefs(row.value)) {
            if (ELIGIBLE.test(ref.key)) keys.set(ref.key, (keys.get(ref.key) || 0) + 1);
        }
    });
    return { keys, rows };
}

async function convert(sharp, body, key) {
    const photo = /\.jpe?g$/i.test(key);
    const image = sharp(body, { failOn: 'none' }).rotate();
    const meta = await image.metadata();
    const width = meta.autoOrient?.width ?? meta.width ?? 0;
    const height = meta.autoOrient?.height ?? meta.height ?? 0;
    const resized = Math.max(width, height) > MAX_SIDE;
    const out = await image
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: photo ? PHOTO_QUALITY : GRAPHIC_QUALITY, alphaQuality: 100, effort: 5 })
        .toBuffer();
    return { out, resized, width, height };
}

async function runPool(items, size, worker) {
    const queue = [...items];
    await Promise.all(Array.from({ length: Math.max(1, Math.min(size, queue.length)) }, async () => {
        for (let item = queue.shift(); item !== undefined; item = queue.shift()) await worker(item);
    }));
}

// ─── cek ───
async function cek(db, storage) {
    const sharp = loadSharp();
    console.log(`Pustaka gambar (sharp): ${sharp ? `tersedia (versi ${sharp.versions?.sharp || '?'})` : 'TIDAK tersedia di sini'}`);
    const { keys, rows } = await collectKeys(db);
    console.log(`Baris soal/ujian yang memuat alamat berkas: ${rows}`);
    console.log(`Gambar JPG/PNG/BMP unik yang dirujuk: ${keys.size}`);
    if (!keys.size) { console.log('Tidak ada gambar lama yang perlu dikonversi.'); return; }

    const sizes = [];
    let missing = 0;
    await runPool([...keys.keys()], 6, async key => {
        const size = await storage.size(key);
        if (size === null) missing++; else sizes.push({ key, size });
    });
    const total = sizes.reduce((sum, item) => sum + item.size, 0);
    const byExt = {};
    for (const { key } of sizes) { const ext = key.split('.').pop().toLowerCase(); byExt[ext] = (byExt[ext] || 0) + 1; }
    console.log(`  per format: ${Object.entries(byExt).map(([ext, n]) => `${ext} ${n}`).join(', ') || '-'}`);
    console.log(`  total ukuran sekarang: ${mb(total)}`);
    console.log(`  lebih dari 500 KB: ${sizes.filter(item => item.size > 500 * 1024).length}; lebih dari 1 MB: ${sizes.filter(item => item.size > 1024 * 1024).length}`);
    if (missing) console.log(`  ${missing} berkas dirujuk tetapi tidak ada di penyimpanan (dilewati).`);

    if (sharp && sizes.length) {
        const sample = [...sizes].sort((a, b) => b.size - a.size).slice(0, 12);
        let before = 0, after = 0;
        for (const { key, size } of sample) {
            const body = await storage.get(key);
            if (!body || isAnimated(body, key)) continue;
            try {
                const { out, resized } = await convert(sharp, body, key);
                before += size;
                after += (resized || out.length < size * 0.95) ? out.length : size;
            } catch { /* gambar rusak: dilewati saat dijalankan */ }
        }
        if (before) {
            const ratio = after / before;
            console.log(`  perkiraan dari ${sample.length} gambar terbesar: ${mb(before)} → ${mb(after)} (hemat ${Math.round((1 - ratio) * 100)}%)`);
        }
    }
    const [{ running }] = await db.query(`SELECT count(*)::int AS running FROM public.cbt_exam_attempts WHERE status = 'in_progress'`);
    console.log(running
        ? `\nPerhatian: ${running} pengerjaan ujian sedang berlangsung. Jalankan konversi setelah ujian selesai.`
        : '\nTidak ada ujian yang sedang berlangsung.');
}

// ─── jalankan ───
async function jalankan(db, storage, backupPath, force) {
    if (!backupPath) throw new Error('Wajib: --cadangan <file>');
    const sharp = loadSharp();
    if (!sharp) throw new Error('Pustaka gambar sharp tidak tersedia di lingkungan ini.');
    const [{ running }] = await db.query(`SELECT count(*)::int AS running FROM public.cbt_exam_attempts WHERE status = 'in_progress'`);
    if (running && !force) throw new Error(`${running} pengerjaan ujian sedang berlangsung. Jalankan setelah ujian selesai (atau --paksa).`);

    const { keys } = await collectKeys(db);
    console.log(`Gambar JPG/PNG/BMP unik yang dirujuk: ${keys.size}`);
    const mapping = new Map(); // kunci lama -> kunci baru
    const stats = { converted: 0, reused: 0, notSmaller: 0, animated: 0, missing: 0, failed: 0, before: 0, after: 0, rows: 0, skippedRows: 0 };
    let done = 0;
    await runPool([...keys.keys()], 3, async key => {
        try {
            const target = `${key}.webp`;
            const body = await storage.get(key);
            if (!body) { stats.missing++; return; }
            if (isAnimated(body, key)) { stats.animated++; return; }
            if (await storage.exists(target)) {
                // Sudah dikonversi pada putaran sebelumnya.
                const convertedSize = (await storage.size(target)) || body.length; // baca dulu, baru tambahkan (pekerja paralel)
                mapping.set(key, target); stats.reused++;
                stats.before += body.length; stats.after += convertedSize;
                return;
            }
            const { out, resized } = await convert(sharp, body, key);
            if (!resized && out.length >= body.length * 0.95) { stats.notSmaller++; return; }
            await storage.put(target, out, 'image/webp');
            mapping.set(key, target);
            stats.converted++; stats.before += body.length; stats.after += out.length;
        } catch (error) {
            stats.failed++;
            console.log(`  ! ${key}: ${error.message}`);
        } finally {
            done++;
            if (done % 25 === 0 || done === keys.size) console.log(`  … ${done}/${keys.size} gambar diproses`);
        }
    });

    const backup = fs.openSync(backupPath, 'a');
    try {
        await eachReferencingRow(db, async ({ target, pk, column, type, row }) => {
            let changed = false;
            const next = row.value.replace(storageUrlPattern(), (full, p1, k1, p2, k2) => {
                const prefix = p1 ?? p2;
                const key = decodeKey(k1 ?? k2);
                const replacement = mapping.get(key);
                if (!replacement) return full;
                changed = true;
                return `${prefix}${encodeKey(replacement)}`;
            });
            if (!changed) return;
            const cast = type === 'jsonb' ? '::jsonb' : type === 'json' ? '::json' : '';
            if (cast) JSON.parse(next); // jangan pernah menulis JSON rusak
            // Cadangan ditulis SEBELUM baris diubah.
            fs.writeSync(backup, `${JSON.stringify({ table: target.table, pk, id: row.id, column, type, value: row.value })}\n`);
            const updated = await db.tx(async tx => {
                if (row.exam_id) {
                    // Kunci yang sama dengan koreksi kunci/revisi soal: penilaian tidak berjalan di tengah perubahan.
                    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))::text AS locked', [`exam-key-correction:${row.exam_id}`]);
                }
                const result = await tx.query(
                    `UPDATE public.${quote(target.table)} SET ${quote(column)} = $1${cast}
                     WHERE ${quote(pk)}::text = $2 AND md5(${quote(column)}::text) = $3 RETURNING 1 AS ok`,
                    [next, row.id, row.hash]);
                return result.length;
            });
            if (updated) stats.rows++; else stats.skippedRows++;
        });
    } finally {
        fs.closeSync(backup);
    }

    console.log(`\nSelesai: ${stats.converted} gambar dikonversi${stats.reused ? `, ${stats.reused} memakai hasil konversi sebelumnya` : ''}.`);
    console.log(`Ukuran gambar yang dikonversi: ${mb(stats.before)} → ${mb(stats.after)}${stats.before ? ` (hemat ${Math.round((1 - stats.after / stats.before) * 100)}%)` : ''}.`);
    console.log(`Baris diperbarui: ${stats.rows}.`);
    if (stats.notSmaller) console.log(`${stats.notSmaller} gambar dibiarkan karena WebP tidak lebih kecil.`);
    if (stats.animated) console.log(`${stats.animated} gambar beranimasi dibiarkan.`);
    if (stats.missing) console.log(`${stats.missing} berkas dirujuk tetapi tidak ada di penyimpanan (dibiarkan).`);
    if (stats.failed) console.log(`${stats.failed} gambar gagal diproses (dibiarkan; lihat daftar di atas).`);
    if (stats.skippedRows) console.log(`${stats.skippedRows} baris berubah saat proses berjalan dan dilewati; jalankan ulang untuk menyelesaikannya.`);
    console.log('Berkas lama tidak dihapus, sehingga pemulihan selalu aman.');
}

// ─── pulihkan ───
async function pulihkan(db, backupPath) {
    if (!backupPath || !fs.existsSync(backupPath)) throw new Error(`File cadangan tidak ditemukan: ${backupPath}`);
    const lines = fs.readFileSync(backupPath, 'utf8').split('\n').filter(Boolean);
    let restored = 0;
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
    if (command === 'sharp') { process.exitCode = loadSharp() ? 0 : 3; return; }
    const db = await openDb();
    try {
        if (command === 'cek') await cek(db, openStorage());
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
