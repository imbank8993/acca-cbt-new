/**
 * Pasang aturan CORS pada bucket R2.
 *
 * Membaca konfigurasi dari apps/web/.env.local — berkas yang sama yang dipakai
 * aplikasi, supaya tidak ada dua sumber kebenaran untuk kredensial R2.
 *
 *   node tools/set-r2-cors.js
 *
 * CATATAN: token R2 yang sekarang dipakai aplikasi bercakupan OBJEK saja, jadi
 * skrip ini berakhir `AccessDenied`. Itu tidak menghalangi apa pun — unggahan
 * berjalan server→R2 (tanpa preflight) dan berkas dibaca sebagai <img> biasa,
 * keduanya tidak memerlukan CORS. Kalau CORS memang perlu diubah, lakukan lewat
 * dasbor Cloudflare atau dengan token bercakupan Admin Read & Write.
 */
import { PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, 'apps', 'web', '.env.local') });

const ACCOUNT_ID = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'acca';

if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
    console.error('CLOUDFLARE_R2_* tidak ditemukan di apps/web/.env.local');
    process.exit(1);
}

const client = new S3Client({
    region: 'auto',
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
});

async function main() {
    try {
        await client.send(
            new PutBucketCorsCommand({
                Bucket: BUCKET,
                CORSConfiguration: {
                    CORSRules: [
                        {
                            AllowedHeaders: ['*'],
                            AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
                            AllowedOrigins: ['*'],
                            ExposeHeaders: ['ETag'],
                            MaxAgeSeconds: 3600,
                        },
                    ],
                },
            }),
        );
        console.log(`CORS terpasang pada bucket ${BUCKET}`);
    } catch (e) {
        console.error('Gagal memasang CORS:', e);
        process.exit(1);
    }
}

main();
