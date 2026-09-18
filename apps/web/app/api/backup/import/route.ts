import crypto from 'node:crypto';
import JSZip from 'jszip';
import { NextRequest, NextResponse } from 'next/server';
import { extractRequestToken } from '@/lib/app-jwt';
import { nestFetchAsUser } from '@/lib/nest-api';
import { ALLOWED_EXTENSIONS, putObject } from '@/lib/storage';

/**
 * Pulihkan cadangan dari berkas ZIP atau `.cbtbak`.
 *
 * Yang dikerjakan di sini hanyalah urusan berkas: membuka arsip, mengunggah
 * ulang gambar ke R2, dan memeriksa keutuhan isinya. Seluruh penulisan basis
 * data dikerjakan NestJS.
 *
 * Tanda tangan diperiksa DI SINI, bukan di NestJS, karena di sinilah berkasnya
 * dibaca — dan pemeriksaan itu soal keutuhan berkas, bukan soal izin. Izinnya
 * tetap ditegakkan NestJS dari token pemanggil.
 */

const BACKUP_SECRET = process.env.BACKUP_SECRET_KEY || 'super-secret-cbt-backup-key-2026';

export async function POST(request: NextRequest) {
    const token = extractRequestToken(request);
    if (!token) {
        return NextResponse.json(
            { success: false, error: 'Sesi tidak valid. Silakan login ulang.' },
            { status: 401 },
        );
    }

    const form = await request.formData();
    const file = form.get('file');
    const organizationId = String(form.get('organizationId') || '');

    if (!(file instanceof File)) {
        return NextResponse.json(
            { success: false, error: 'Berkas cadangan belum dipilih.' },
            { status: 400 },
        );
    }
    if (!organizationId) {
        return NextResponse.json(
            { success: false, error: 'organizationId wajib diisi.' },
            { status: 400 },
        );
    }

    let content: string;
    try {
        content = file.name.toLowerCase().endsWith('.zip')
            ? await readArchive(file)
            : await file.text();
    } catch (error) {
        return NextResponse.json(
            { success: false, error: (error as Error).message },
            { status: 400 },
        );
    }

    let backup: { signature?: string; [key: string]: unknown };
    try {
        backup = JSON.parse(content);
    } catch {
        return NextResponse.json(
            { success: false, error: 'Berkas cadangan tidak dapat dibaca.' },
            { status: 400 },
        );
    }

    const { signature, ...payload } = backup;
    if (!signature || !payload.data) {
        return NextResponse.json(
            { success: false, error: 'Format berkas cadangan tidak dikenali.' },
            { status: 400 },
        );
    }

    const expected = crypto
        .createHmac('sha256', BACKUP_SECRET)
        .update(JSON.stringify(payload))
        .digest('hex');

    // Perbandingan waktu-tetap: pembanding biasa membocorkan berapa banyak
    // karakter awal yang sudah cocok, dan itu cukup untuk menebak tanda tangan
    // satu karakter demi satu karakter.
    if (!timingSafeEqual(signature, expected)) {
        return NextResponse.json(
            {
                success: false,
                error: 'Pemeriksaan keutuhan gagal. Berkas cadangan rusak atau telah diubah.',
            },
            { status: 400 },
        );
    }

    const { status, body } = await nestFetchAsUser<{ error?: string }>('/backup/import', token, {
        method: 'POST',
        body: JSON.stringify({ organizationId, payload }),
    });

    if (status < 200 || status >= 300) {
        return NextResponse.json(
            { success: false, error: body?.error || 'Pemulihan gagal.' },
            { status },
        );
    }

    return NextResponse.json({ success: true, ...body });
}

/**
 * Buka arsip: unggah ulang gambarnya ke R2, lalu kembalikan isi `backup.cbtbak`
 * dengan jalur di dalam arsip sudah diganti menjadi URL yang baru.
 */
async function readArchive(file: File): Promise<string> {
    const zip = await new JSZip().loadAsync(await file.arrayBuffer());

    const manifest = zip.file('backup.cbtbak');
    if (!manifest) {
        throw new Error('Berkas backup.cbtbak tidak ditemukan di dalam arsip.');
    }

    let content = await manifest.async('string');

    const images = zip.folder('images');
    if (!images) return content;

    const entries = Object.keys(images.files).filter((name) => !images.files[name].dir);

    for (const name of entries) {
        try {
            const buffer = await images.files[name].async('nodebuffer');
            const extension = (name.split('.').pop() || 'jpg').toLowerCase();
            const key = `backup-restores/${Date.now()}_${Math.random().toString(36).slice(2)}.${extension}`;

            // Content-Type diambil dari daftar yang sama dengan jalur unggah
            // biasa. Merakitnya sebagai `image/${ext}` menghasilkan `image/jpg` —
            // tipe yang tidak sah, dan sebagian browser menolak menampilkannya.
            const uploaded = await putObject(
                key,
                buffer,
                ALLOWED_EXTENSIONS[extension] || 'application/octet-stream',
            );

            if (uploaded.success && uploaded.url) {
                content = content.split(`src=\\"${name}\\"`).join(`src=\\"${uploaded.url}\\"`);
            } else {
                console.warn(`[backup] Gambar gagal diunggah: ${name}`, uploaded.error);
            }
        } catch (error) {
            console.warn(`[backup] Gambar gagal dipulihkan: ${name}`, error);
        }
    }

    return content;
}

function timingSafeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    // `crypto.timingSafeEqual` melempar bila panjangnya berbeda, jadi panjangnya
    // diperiksa lebih dulu — dan panjang tanda tangan memang bukan rahasia.
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}
