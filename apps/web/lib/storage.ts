/**
 * Penyimpanan berkas — Cloudflare R2, satu-satunya penyedia.
 *
 * SERVER-ONLY. Modul ini memegang `CLOUDFLARE_R2_SECRET_ACCESS_KEY`; jangan
 * pernah diimpor dari komponen `'use client'`. Tidak ada satu pun nilai di sini
 * yang boleh diberi prefix `NEXT_PUBLIC_`.
 *
 * Konfigurasinya dibaca dari environment, BUKAN dari tabel `acca_settings`.
 * Versi lama menyimpan kredensial R2 sebagai JSON pada baris `storage_config`,
 * dan itu menimbulkan dua masalah sekaligus: satu query `select('*')` yang lalai
 * menyaring akan mengirim `secret_access_key` ke browser siapa pun (lihat
 * `SENSITIVE_KEYS` di apps/api/src/settings/settings.service.ts), dan seluruh
 * unggahan ikut mati setiap kali baris itu gagal terbaca — diam-diam, karena
 * pemanggilnya jatuh ke provider default.
 */

import {
    DeleteObjectCommand,
    HeadBucketCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';

// ─── Konfigurasi ─────────────────────────────────────────────────────────────

export interface R2Config {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    /** Basis URL publik bucket, tanpa garis miring di akhir. Boleh kosong. */
    publicUrl: string;
}

let cached: { config: R2Config; client: S3Client } | null = null;
let warned = false;

function readEnvConfig(): R2Config | null {
    const driver = (process.env.STORAGE_DRIVER || 'cloudflare').toLowerCase();
    if (driver !== 'cloudflare' && driver !== 'r2') {
        if (!warned) {
            warned = true;
            console.error(
                `[storage] STORAGE_DRIVER='${driver}' tidak dikenal. Satu-satunya penyedia adalah Cloudflare R2.`,
            );
        }
        return null;
    }

    const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID || '';
    const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
    const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';
    const bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME || '';

    const missing = [
        !accountId && 'CLOUDFLARE_R2_ACCOUNT_ID',
        !accessKeyId && 'CLOUDFLARE_R2_ACCESS_KEY_ID',
        !secretAccessKey && 'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
        !bucket && 'CLOUDFLARE_R2_BUCKET_NAME',
    ].filter(Boolean);

    if (missing.length > 0) {
        if (!warned) {
            warned = true;
            console.error(`[storage] Konfigurasi R2 tidak lengkap: ${missing.join(', ')} belum diisi.`);
        }
        return null;
    }

    return {
        accountId,
        accessKeyId,
        secretAccessKey,
        bucket,
        publicUrl: (process.env.CLOUDFLARE_R2_PUBLIC_URL || '').replace(/\/+$/, ''),
    };
}

function r2(): { config: R2Config; client: S3Client } | null {
    if (cached) return cached;
    const config = readEnvConfig();
    if (!config) return null;

    cached = {
        config,
        client: new S3Client({
            region: 'auto',
            endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
        }),
    };
    return cached;
}

/** True bila keempat nilai wajib R2 terisi. */
export function isStorageConfigured(): boolean {
    return r2() !== null;
}

/** Konfigurasi aktif tanpa rahasia — aman dikirim ke browser. */
export function storageStatus(): {
    configured: boolean;
    provider: 'cloudflare-r2';
    bucket: string;
    publicUrl: string;
} {
    const active = r2();
    return {
        configured: active !== null,
        provider: 'cloudflare-r2',
        bucket: active?.config.bucket || '',
        publicUrl: active?.config.publicUrl || '',
    };
}

// ─── Berkas yang boleh masuk ─────────────────────────────────────────────────

/**
 * Ekstensi yang diizinkan → Content-Type yang dipakai saat menyimpan.
 * Content-Type dari klien sengaja diabaikan: kalau dipercaya, penyerang bisa
 * menyimpan berkas dengan tipe `text/html` lalu menyajikannya dari bucket
 * publik dengan asal yang sama untuk seluruh berkas sekolah.
 */
export const ALLOWED_EXTENSIONS: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    csv: 'text/csv',
    zip: 'application/zip',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    webm: 'video/webm',
};

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

export function getExtension(originalName: string): string {
    const parts = (originalName || '').split('.');
    if (parts.length < 2) return '';
    return (parts.pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function generateFileName(ext: string): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
}

// ─── URL objek ───────────────────────────────────────────────────────────────

/** URL publik sebuah object key. String kosong bila R2 belum dikonfigurasi. */
export function publicUrlForKey(key: string): string {
    const active = r2();
    if (!active) return '';
    const { config } = active;
    if (config.publicUrl) return `${config.publicUrl}/${key}`;
    // Tanpa CLOUDFLARE_R2_PUBLIC_URL, berkas hanya terjangkau lewat endpoint
    // bertanda tangan. URL ini disimpan supaya objeknya masih bisa dilacak,
    // tetapi gambar tidak akan tampil di browser.
    return `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}`;
}

/**
 * Kebalikan `publicUrlForKey`: ubah URL publik kembali menjadi object key.
 * Mengembalikan null bila URL itu bukan milik bucket kita — termasuk URL
 * Supabase Storage lama, yang memang tidak bisa lagi disentuh dari sini.
 */
export function objectKeyFromUrl(fileUrl: string): string | null {
    const active = r2();
    if (!active || !fileUrl) return null;
    const { config } = active;

    const decode = (raw: string): string | null => {
        const key = raw.split('?')[0].replace(/^\/+/, '');
        if (!key) return null;
        try {
            return decodeURIComponent(key);
        } catch {
            return key;
        }
    };

    if (config.publicUrl && fileUrl.startsWith(`${config.publicUrl}/`)) {
        return decode(fileUrl.slice(config.publicUrl.length));
    }

    let url: URL;
    try {
        url = new URL(fileUrl);
    } catch {
        return null;
    }

    // Domain publik r2.dev, mis. https://pub-<hash>.r2.dev/<key>
    if (url.hostname.endsWith('.r2.dev')) {
        return decode(url.pathname);
    }

    // Endpoint S3 gaya path: https://<account>.r2.cloudflarestorage.com/<bucket>/<key>
    if (url.hostname === `${config.accountId}.r2.cloudflarestorage.com`) {
        const parts = url.pathname.replace(/^\/+/, '').split('/');
        if (parts.shift() !== config.bucket) return null;
        return decode(parts.join('/'));
    }

    // Endpoint S3 gaya virtual-host: https://<bucket>.<account>.r2.cloudflarestorage.com/<key>
    if (url.hostname === `${config.bucket}.${config.accountId}.r2.cloudflarestorage.com`) {
        return decode(url.pathname);
    }

    return null;
}

// ─── Operasi objek ───────────────────────────────────────────────────────────

export interface StorageResult {
    success: boolean;
    url?: string;
    key?: string;
    error?: string;
}

/**
 * Simpan satu objek. `key` adalah jalur penuh di dalam bucket, mis.
 * `banks/<bankId>/equations/173..._ab12cd.svg`.
 */
export async function putObject(
    key: string,
    body: Buffer,
    contentType: string,
): Promise<StorageResult> {
    const active = r2();
    if (!active) {
        return { success: false, error: 'Penyimpanan belum dikonfigurasi. Periksa CLOUDFLARE_R2_* di environment.' };
    }

    try {
        await active.client.send(
            new PutObjectCommand({
                Bucket: active.config.bucket,
                Key: key,
                Body: body,
                ContentType: contentType,
            }),
        );
        return { success: true, key, url: publicUrlForKey(key) };
    } catch (err) {
        const message = (err as Error).message || String(err);
        console.error(`[storage] Gagal menyimpan '${key}':`, message);
        return { success: false, error: message };
    }
}

/** Hapus satu objek berdasarkan key-nya. */
export async function deleteObject(key: string): Promise<{ success: boolean; error?: string }> {
    const active = r2();
    if (!active) {
        return { success: false, error: 'Penyimpanan belum dikonfigurasi.' };
    }

    try {
        await active.client.send(
            new DeleteObjectCommand({ Bucket: active.config.bucket, Key: key }),
        );
        return { success: true };
    } catch (err) {
        const message = (err as Error).message || String(err);
        console.warn(`[storage] Gagal menghapus '${key}':`, message);
        return { success: false, error: message };
    }
}

/**
 * Hapus objek dari URL publiknya. URL yang bukan milik bucket kita (mis.
 * peninggalan Supabase Storage) dilewati tanpa galat: pemanggilnya sedang
 * membersihkan lampiran, dan itu tidak boleh menggagalkan operasi utama.
 */
export async function deleteObjectByUrl(fileUrl: string): Promise<{ success: boolean; error?: string }> {
    const key = objectKeyFromUrl(fileUrl);
    if (!key) return { success: false, error: 'URL bukan objek penyimpanan yang dikenali.' };
    return deleteObject(key);
}

/** Uji koneksi ke bucket. Dipakai health check dan skrip pemeriksaan. */
export async function testConnection(): Promise<{ success: boolean; message?: string; error?: string }> {
    const active = r2();
    if (!active) {
        return { success: false, error: 'Konfigurasi R2 tidak lengkap.' };
    }

    try {
        await active.client.send(new HeadBucketCommand({ Bucket: active.config.bucket }));
        return { success: true, message: `Terhubung ke Cloudflare R2, bucket "${active.config.bucket}".` };
    } catch (err) {
        const message = (err as Error).message || String(err);
        if (message.includes('403') || message.includes('Forbidden')) {
            return { success: false, error: 'R2: akses ditolak. Periksa Access Key ID dan Secret.' };
        }
        if (message.includes('404') || message.includes('NoSuchBucket')) {
            return { success: false, error: `R2: bucket "${active.config.bucket}" tidak ditemukan.` };
        }
        return { success: false, error: `R2: ${message}` };
    }
}
