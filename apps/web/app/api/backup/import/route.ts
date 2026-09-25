import crypto from 'node:crypto';
import JSZip from 'jszip';
import { NextRequest, NextResponse } from 'next/server';
import { extractRequestToken } from '@/lib/app-jwt';
import { nestFetchAsUser } from '@/lib/nest-api';
import { ALLOWED_EXTENSIONS, deleteObject, putObject } from '@/lib/storage';

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

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 120 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ENTRIES = 501;
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg']);

export async function POST(request: NextRequest) {
    const token = extractRequestToken(request);
    if (!token) {
        return NextResponse.json(
            { success: false, error: 'Sesi tidak valid. Silakan login ulang.' },
            { status: 401 },
        );
    }

    // organizationId wajib tersedia di URL agar izin dapat diperiksa SEBELUM
    // multipart body dibaca, ZIP dibuka, atau objek apa pun diunggah.
    const organizationId = request.nextUrl.searchParams.get('organizationId') || '';
    if (!organizationId) {
        return NextResponse.json(
            { success: false, error: 'organizationId wajib diisi pada URL.' },
            { status: 400 },
        );
    }
    const backupSecret = process.env.BACKUP_SECRET_KEY;
    if (!backupSecret || backupSecret.length < 32) {
        return NextResponse.json(
            { success: false, error: 'BACKUP_SECRET_KEY belum dikonfigurasi dengan aman.' },
            { status: 503 },
        );
    }
    const declaredSize = Number(request.headers.get('content-length') || 0);
    if (declaredSize > MAX_ARCHIVE_BYTES + 1024 * 1024) {
        return NextResponse.json(
            { success: false, error: 'Ukuran berkas backup melewati batas 50 MB.' },
            { status: 413 },
        );
    }

    const authorization = await nestFetchAsUser<{ error?: string }>(
        `/backup/import-authorization?organizationId=${encodeURIComponent(organizationId)}`,
        token,
    );
    if (authorization.status < 200 || authorization.status >= 300) {
        return NextResponse.json(
            { success: false, error: authorization.body?.error || 'Tidak diizinkan memulihkan backup.' },
            { status: authorization.status },
        );
    }

    const form = await request.formData();
    const file = form.get('file');
    const bodyOrganizationId = String(form.get('organizationId') || '');

    if (!(file instanceof File)) {
        return NextResponse.json(
            { success: false, error: 'Berkas cadangan belum dipilih.' },
            { status: 400 },
        );
    }
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.zip') && !lowerName.endsWith('.cbtbak')) {
        return NextResponse.json(
            { success: false, error: 'Format berkas harus .zip atau .cbtbak.' },
            { status: 400 },
        );
    }
    if (bodyOrganizationId !== organizationId) {
        return NextResponse.json(
            { success: false, error: 'organizationId pada berkas tidak cocok dengan permintaan.' },
            { status: 400 },
        );
    }
    if (file.size > MAX_ARCHIVE_BYTES) {
        return NextResponse.json(
            { success: false, error: 'Ukuran berkas backup melewati batas 50 MB.' },
            { status: 413 },
        );
    }

    let content: string;
    let archive: JSZip | null = null;
    try {
        if (lowerName.endsWith('.zip')) {
            const opened = await readArchive(file);
            content = opened.content;
            archive = opened.zip;
        } else {
            content = await file.text();
            if (Buffer.byteLength(content, 'utf8') > MAX_MANIFEST_BYTES) {
                throw new Error('Manifest backup melewati batas 20 MB.');
            }
        }
    } catch (error) {
        return NextResponse.json(
            { success: false, error: (error as Error).message },
            { status: 400 },
        );
    }

    let payload: Record<string, unknown>;
    try {
        payload = verifyBackupContent(content, backupSecret);
    } catch (error) {
        return NextResponse.json(
            { success: false, error: (error as Error).message },
            { status: 400 },
        );
    }

    let importPayload = payload;
    let uploadedKeys: string[] = [];
    try {
        if (archive) {
            const restored = await restoreArchiveImages(archive, payload);
            importPayload = restored.payload;
            uploadedKeys = restored.uploadedKeys;
        }
    } catch (error) {
        return NextResponse.json(
            { success: false, error: (error as Error).message },
            { status: 400 },
        );
    }

    const { status, body } = await nestFetchAsUser<{ error?: string }>('/backup/import', token, {
        method: 'POST',
        body: JSON.stringify({ organizationId, payload: importPayload }),
    });

    if (status < 200 || status >= 300) {
        await Promise.allSettled(uploadedKeys.map((key) => deleteObject(key)));
        return NextResponse.json(
            { success: false, error: body?.error || 'Pemulihan gagal.' },
            { status },
        );
    }

    return NextResponse.json({ success: true, ...body });
}

/**
 * Buka dan validasi struktur arsip tanpa mengekstrak semua isinya. Tidak ada
 * upload pada tahap ini: signature manifest harus lolos lebih dulu.
 */
export async function readArchive(file: File): Promise<{ content: string; zip: JSZip }> {
    const zip = await new JSZip().loadAsync(await file.arrayBuffer());

    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    if (entries.length > MAX_ENTRIES) throw new Error(`Jumlah berkas melewati batas ${MAX_ENTRIES}.`);

    let totalSize = 0;
    for (const entry of entries) {
        const name = entry.name.replace(/\\/g, '/');
        if (name.startsWith('/') || name.split('/').includes('..')) {
            throw new Error('Arsip memuat jalur berkas yang tidak aman.');
        }
        if (name !== 'backup.cbtbak' && !name.startsWith('images/')) {
            throw new Error(`Berkas tidak dikenal di dalam arsip: ${name}`);
        }
        const size = Number((entry as any)._data?.uncompressedSize);
        if (!Number.isFinite(size) || size < 0) throw new Error('Ukuran isi arsip tidak valid.');
        if (name === 'backup.cbtbak' && size > MAX_MANIFEST_BYTES) {
            throw new Error('Manifest backup melewati batas 20 MB.');
        }
        if (name.startsWith('images/') && size > MAX_IMAGE_BYTES) {
            throw new Error(`Gambar ${name} melewati batas 10 MB.`);
        }
        totalSize += size;
        if (totalSize > MAX_UNCOMPRESSED_BYTES) {
            throw new Error('Hasil dekompresi backup melewati batas 120 MB.');
        }
    }

    const manifest = zip.file('backup.cbtbak');
    if (!manifest) {
        throw new Error('Berkas backup.cbtbak tidak ditemukan di dalam arsip.');
    }

    const content = await manifest.async('string');
    return { content, zip };
}

/** Unggah gambar setelah otorisasi dan signature lolos, lalu petakan path manifest. */
async function restoreArchiveImages(
    zip: JSZip,
    payload: Record<string, unknown>,
): Promise<{ payload: Record<string, unknown>; uploadedKeys: string[] }> {
    let content = JSON.stringify(payload);
    const uploadedKeys: string[] = [];

    const entries = Object.keys(zip.files).filter(
        (name) => name.startsWith('images/') && !zip.files[name].dir,
    );
    if (entries.length === 0) return { payload, uploadedKeys };

    try {
      for (const name of entries) {
        const extension = (name.split('.').pop() || '').toLowerCase();
        if (!IMAGE_EXTENSIONS.has(extension)) {
            throw new Error(`Ekstensi gambar tidak diizinkan: ${name}`);
        }
        const buffer = await zip.files[name].async('nodebuffer');
        if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error(`Gambar ${name} melewati batas 10 MB.`);
        const key = `backup-restores/${crypto.randomUUID()}.${extension}`;
        const uploaded = await putObject(key, buffer, ALLOWED_EXTENSIONS[extension]);
        if (!uploaded.success || !uploaded.url) {
            throw new Error(`Gambar ${name} gagal diunggah: ${uploaded.error || 'tidak diketahui'}`);
        }
        uploadedKeys.push(key);
        content = content.split(`src=\\"${name}\\"`).join(`src=\\"${uploaded.url}\\"`);
      }
      return { payload: JSON.parse(content), uploadedKeys };
    } catch (error) {
      await Promise.allSettled(uploadedKeys.map((key) => deleteObject(key)));
      throw error;
    }
}

export function verifyBackupContent(content: string, secret: string): Record<string, unknown> {
    let backup: { signature?: string; [key: string]: unknown };
    try {
        backup = JSON.parse(content);
    } catch {
        throw new Error('Berkas cadangan tidak dapat dibaca.');
    }
    const { signature, ...payload } = backup;
    if (!signature || !payload.data) throw new Error('Format berkas cadangan tidak dikenali.');
    const expected = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(payload)).digest('hex');
    if (!timingSafeEqual(signature, expected)) {
        throw new Error('Pemeriksaan keutuhan gagal. Berkas cadangan rusak atau telah diubah.');
    }
    return payload;
}

function timingSafeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    // `crypto.timingSafeEqual` melempar bila panjangnya berbeda, jadi panjangnya
    // diperiksa lebih dulu — dan panjang tanda tangan memang bukan rahasia.
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}
