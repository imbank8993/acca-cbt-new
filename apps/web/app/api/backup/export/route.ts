import crypto from 'node:crypto';
import JSZip from 'jszip';
import { NextRequest, NextResponse } from 'next/server';
import { extractRequestToken } from '@/lib/app-jwt';
import { nestFetchAsUser } from '@/lib/nest-api';
import { getObject, objectKeyFromUrl } from '@/lib/storage';

/**
 * Unduh cadangan seluruh data sekolah sebagai berkas ZIP.
 *
 * Pembagiannya sama dengan jalur impor soal: NestJS membaca basis datanya,
 * `apps/web` yang mengurus berkas — di sini mengunduh setiap gambar yang dirujuk
 * soal, memasukkannya ke dalam arsip, lalu menandatangani isinya.
 *
 * Gambar ikut diarsipkan supaya cadangan tetap berguna ketika bucket R2-nya
 * hilang: tanpa itu, yang tersisa hanyalah tautan yang sudah mati.
 */

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ARCHIVED_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_IMAGES = 500;
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg']);

/** `src="…"` di dalam JSON yang sudah di-stringify — kutipnya ikut ter-escape. */
const IMAGE_SRC_PATTERN = /src=\\"(https?:\/\/[^\\]+)\\"/gi;

export async function GET(request: NextRequest) {
    const token = extractRequestToken(request);
    if (!token) {
        return NextResponse.json(
            { success: false, error: 'Sesi tidak valid. Silakan login ulang.' },
            { status: 401 },
        );
    }

    const backupSecret = process.env.BACKUP_SECRET_KEY;
    if (!backupSecret || backupSecret.length < 32) {
        return NextResponse.json(
            { success: false, error: 'BACKUP_SECRET_KEY belum dikonfigurasi dengan aman.' },
            { status: 503 },
        );
    }

    const { status, body } = await nestFetchAsUser<any>(
        '/backup/export',
        token,
    );

    if (status < 200 || status >= 300 || !body) {
        return NextResponse.json(
            { success: false, error: body?.error || 'Gagal menyiapkan cadangan.' },
            { status: status || 500 },
        );
    }

    const zip = new JSZip();
    const images = zip.folder('images');

    // Tautan gambar diganti dengan jalur di dalam arsip. Penggantiannya dilakukan
    // pada bentuk JSON yang sudah di-stringify, bukan dengan menelusuri objeknya:
    // gambar bisa muncul di teks soal, teks opsi, stimulus, maupun petunjuk, dan
    // menelusuri semuanya berarti menebak-nebak bidang mana yang memuat HTML.
    let payloadText = JSON.stringify(body);
    const urls = [...new Set([...payloadText.matchAll(IMAGE_SRC_PATTERN)].map((m) => m[1]))];
    if (urls.length > MAX_IMAGES) {
        return NextResponse.json(
            { success: false, error: `Jumlah gambar melewati batas ${MAX_IMAGES}.` },
            { status: 413 },
        );
    }

    let counter = 1;
    let totalImageBytes = 0;
    for (const url of urls) {
        // Jangan fetch URL tersimpan. Hanya objek yang terbukti berasal dari
        // bucket aplikasi boleh dibaca, langsung lewat API R2 berdasarkan key.
        const key = objectKeyFromUrl(url);
        if (!key) continue;
        const extension = key.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() || '';
        if (!IMAGE_EXTENSIONS.has(extension)) continue;

        const downloaded = await getObject(key, MAX_IMAGE_BYTES);
        if (!downloaded.success || !downloaded.body) {
            console.warn(`[backup] Gambar gagal diarsipkan: ${key}`, downloaded.error);
            continue;
        }
        totalImageBytes += downloaded.body.byteLength;
        if (totalImageBytes > MAX_ARCHIVED_IMAGE_BYTES) {
            return NextResponse.json(
                { success: false, error: 'Total ukuran gambar backup melewati batas 100 MB.' },
                { status: 413 },
            );
        }

        const fileName = `img_${counter++}_${Date.now()}.${extension}`;
        images?.file(fileName, downloaded.body);
        payloadText = payloadText.split(`src=\\"${url}\\"`).join(`src=\\"images/${fileName}\\"`);
    }

    // Tanda tangan dihitung dari teks SETELAH tautan diganti — persis teks yang
    // disimpan — supaya pemeriksaan saat impor memakai masukan yang sama.
    const signature = crypto
        .createHmac('sha256', backupSecret)
        .update(payloadText)
        .digest('hex');

    zip.file('backup.cbtbak', JSON.stringify({ signature, ...JSON.parse(payloadText) }, null, 2));

    const orgName = String(body.organization?.name || 'sekolah').replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `backup_${orgName}_${new Date().toISOString().split('T')[0]}.zip`;

    const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    return new NextResponse(archive as unknown as BodyInit, {
        headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${fileName}"`,
        },
    });
}
