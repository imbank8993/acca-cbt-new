/**
 * Periksa penyimpanan berkas dari ujung ke ujung.
 *
 *   node tools/check-storage.mjs
 *
 * Menjawab empat pertanyaan yang masing-masing pernah gagal diam-diam:
 *
 *   1. Apakah CLOUDFLARE_R2_* terisi?
 *   2. Apakah kredensialnya diterima bucket?
 *   3. Apakah aplikasi bisa MENULIS objek?
 *   4. Apakah objek itu bisa DIBACA lewat URL publik yang disimpan ke database?
 *
 * Pertanyaan keempat yang paling sering luput. Unggahan bisa sukses sementara
 * gambarnya tetap tidak muncul di layar peserta — misalnya karena domain
 * `*.r2.dev` bawaan R2 diblokir di tingkat DNS oleh sebagian ISP Indonesia.
 *
 * Objek ujinya dihapus lagi di akhir.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    DeleteObjectCommand,
    HeadBucketCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_ENV_FILE = path.join(ROOT, 'apps', 'api', '.env');
const WEB_ENV_FILE = path.join(ROOT, 'apps', 'web', '.env.local');

function loadEnv() {
    const envFile = fs.existsSync(API_ENV_FILE) ? API_ENV_FILE : WEB_ENV_FILE;
    if (!fs.existsSync(envFile)) {
        console.error(`TIDAK ADA file .env di apps/api/.env maupun apps/web/.env.local.`);
        process.exit(1);
    }
    return {
        ...Object.fromEntries(
            fs
                .readFileSync(envFile, 'utf-8')
                .split(/\r?\n/)
                .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
                .map((l) => {
                    const i = l.indexOf('=');
                    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
                }),
        ),
        _source: path.relative(ROOT, envFile),
    };
}

const mask = (v) => (v ? `${'•'.repeat(8)}${v.slice(-4)}` : '(kosong)');

const env = loadEnv();
const accountId = env.CLOUDFLARE_R2_ACCOUNT_ID || '';
const accessKeyId = env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
const secretAccessKey = env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';
const bucket = env.CLOUDFLARE_R2_BUCKET_NAME || '';
const publicUrl = (env.CLOUDFLARE_R2_PUBLIC_URL || '').replace(/\/+$/, '');

console.log(`konfigurasi (${env._source})`);
console.log(`  STORAGE_DRIVER                  : ${env.STORAGE_DRIVER || '(kosong)'}`);
console.log(`  CLOUDFLARE_R2_ACCOUNT_ID        : ${accountId || '(kosong)'}`);
console.log(`  CLOUDFLARE_R2_ACCESS_KEY_ID     : ${mask(accessKeyId)}`);
console.log(`  CLOUDFLARE_R2_SECRET_ACCESS_KEY : ${mask(secretAccessKey)}`);
console.log(`  CLOUDFLARE_R2_BUCKET_NAME       : ${bucket || '(kosong)'}`);
console.log(`  CLOUDFLARE_R2_PUBLIC_URL        : ${publicUrl || '(kosong)'}`);
console.log();

if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    console.error('GAGAL  Konfigurasi belum lengkap.');
    process.exit(1);
}

const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
});

const key = `misc/_healthcheck_${Date.now()}.txt`;
const body = `uji tulis acca-cbt ${new Date().toISOString()}`;
let failed = false;

try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`OK     bucket "${bucket}" terjangkau`);
} catch (e) {
    console.error(`GAGAL  bucket tidak terjangkau: ${e.message}`);
    process.exit(1);
}

try {
    await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'text/plain' }),
    );
    console.log(`OK     tulis objek (${key})`);
} catch (e) {
    console.error(`GAGAL  tidak bisa menulis objek: ${e.message}`);
    process.exit(1);
}

if (!publicUrl) {
    console.warn('PERINGATAN  CLOUDFLARE_R2_PUBLIC_URL kosong — berkas tersimpan tetapi URL-nya tidak bisa dibuka browser.');
    failed = true;
} else {
    const url = `${publicUrl}/${key}`;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        const text = await res.text();
        if (res.status === 200 && text === body) {
            console.log(`OK     baca lewat URL publik (HTTP 200, isi cocok)`);
        } else {
            console.error(`GAGAL  URL publik menjawab HTTP ${res.status} dengan isi tak terduga`);
            failed = true;
        }
    } catch (e) {
        failed = true;
        console.error(`GAGAL  URL publik tidak terjangkau: ${e.cause?.code || e.name}`);
        console.error(`       ${url}`);
        if (publicUrl.includes('.r2.dev')) {
            console.error();
            console.error('       Domain `*.r2.dev` bawaan R2 diblokir di tingkat DNS oleh sebagian');
            console.error('       ISP Indonesia — nama host dialihkan ke halaman blokir, sehingga');
            console.error('       gambar soal tidak muncul di perangkat peserta meski unggahannya');
            console.error('       berhasil. Pasang custom domain di Cloudflare → R2 → bucket →');
            console.error('       Settings → Custom Domains, lalu arahkan CLOUDFLARE_R2_PUBLIC_URL');
            console.error('       ke domain itu.');
        }
    }
}

try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    console.log(`OK     hapus objek uji`);
} catch (e) {
    console.error(`PERINGATAN  objek uji gagal dihapus (${key}): ${e.message}`);
}

process.exit(failed ? 1 : 0);
