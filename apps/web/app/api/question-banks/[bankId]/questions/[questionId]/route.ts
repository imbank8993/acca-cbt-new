import { NextRequest, NextResponse } from 'next/server';
import { extractRequestToken } from '@/lib/app-jwt';
import { nestFetchAsUser } from '@/lib/nest-api';
import { deleteObject, objectKeyFromUrl } from '@/lib/storage';

/**
 * Hapus satu soal, lalu bersihkan berkas gambarnya.
 *
 * Pembagiannya mengikuti aturan yang sama dengan impor massal: NestJS yang
 * menghapus barisnya dan memutuskan gambar mana yang menjadi yatim, `apps/web`
 * yang menghapus berkasnya — hanya di sinilah kredensial R2 ada.
 *
 * Penghapusan berkas dikerjakan SETELAH barisnya hilang, dan kegagalannya tidak
 * membatalkan apa pun: soalnya memang sudah terhapus, dan berkas yang tertinggal
 * hanyalah ruang terpakai, bukan data yang salah.
 */
export async function DELETE(
    request: NextRequest,
    context: { params: Promise<{ bankId: string; questionId: string }> },
) {
    const { bankId, questionId } = await context.params;

    const token = extractRequestToken(request);
    if (!token) {
        return NextResponse.json(
            { success: false, error: 'Sesi tidak valid. Silakan login ulang.' },
            { status: 401 },
        );
    }

    const { status, body } = await nestFetchAsUser<{
        id?: string;
        softDeleted?: boolean;
        orphanedImages?: string[];
        message?: string;
        error?: string;
    }>(
        `/question-banks/${encodeURIComponent(bankId)}/questions/${encodeURIComponent(questionId)}`,
        token,
        { method: 'DELETE' },
    );

    if (status < 200 || status >= 300) {
        return NextResponse.json(
            { success: false, error: body?.error || 'Gagal menghapus soal.' },
            { status },
        );
    }

    let removedFiles = 0;
    for (const url of body?.orphanedImages || []) {
        // `objectKeyFromUrl` mengembalikan null untuk URL di luar bucket kita —
        // mis. gambar yang ditempel guru dari internet — jadi hanya berkas milik
        // sendiri yang ikut terhapus.
        const key = objectKeyFromUrl(url);
        if (!key) continue;

        const removed = await deleteObject(key);
        if (removed.success) removedFiles++;
        else console.error('[question-delete] Gagal menghapus berkas:', key, removed.error);
    }

    return NextResponse.json({
        success: true,
        id: body?.id,
        softDeleted: body?.softDeleted ?? false,
        message: body?.message,
        removedFiles,
    });
}
