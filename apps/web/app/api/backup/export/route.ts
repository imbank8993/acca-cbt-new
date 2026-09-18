import crypto from 'node:crypto';
import JSZip from 'jszip';
import { NextRequest, NextResponse } from 'next/server';
import { extractRequestToken } from '@/lib/app-jwt';
import { nestFetchAsUser } from '@/lib/nest-api';

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

const BACKUP_SECRET = process.env.BACKUP_SECRET_KEY || 'super-secret-cbt-backup-key-2026';

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

    const organizationId = request.nextUrl.searchParams.get('organizationId') || '';
    if (!organizationId) {
        return NextResponse.json(
            { success: false, error: 'organizationId wajib diisi.' },
            { status: 400 },
        );
    }

    const { status, body } = await nestFetchAsUser<any>(
        `/backup/export?organizationId=${encodeURIComponent(organizationId)}`,
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

    let counter = 1;
    for (const url of urls) {
        try {
            const response = await fetch(url);
            if (!response.ok) continue;

            const extension = url.match(/\.([a-zA-Z0-9]+)(?:[?#]|$)/)?.[1] ?? 'jpg';
            const fileName = `img_${counter++}_${Date.now()}.${extension}`;

            images?.file(fileName, await response.arrayBuffer());
            payloadText = payloadText.split(`src=\\"${url}\\"`).join(`src=\\"images/${fileName}\\"`);
        } catch (error) {
            // Gambar yang gagal diunduh tetap memakai tautan aslinya. Cadangan
            // tanpa satu gambar masih berguna; membatalkan seluruh ekspor karena
            // satu berkas tidak.
            console.warn(`[backup] Gambar gagal diarsipkan: ${url}`, error);
        }
    }

    // Tanda tangan dihitung dari teks SETELAH tautan diganti — persis teks yang
    // disimpan — supaya pemeriksaan saat impor memakai masukan yang sama.
    const signature = crypto
        .createHmac('sha256', BACKUP_SECRET)
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
