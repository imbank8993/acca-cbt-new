import { NextRequest, NextResponse } from 'next/server';
import { proxy } from '@/lib/nest-proxy';

/**
 * Titipan jawaban terakhir lewat `navigator.sendBeacon` — dipakai saat tab ujian
 * ditutup atau disembunyikan, dan tepat sebelum reload paksa akibat pelanggaran.
 *
 * Alamatnya sengaja BUKAN `/api/students/attempts/:id/answers`: `sendBeacon`
 * hanya bisa mengirim POST, sementara endpoint itu menerima PUT. Route ini
 * menjembatani keduanya, dan tetap tidak menyentuh basis data — otorisasi,
 * kepemilikan pengerjaan, dan pemeriksaan status tetap dikerjakan NestJS.
 *
 * Cookie ikut terkirim karena permintaannya same-origin, jadi sesinya terbaca
 * seperti pada autosave biasa.
 */
export async function POST(request: NextRequest) {
    let payload: { attemptId?: string; answers?: unknown[]; deviceId?: string };
    try {
        payload = await request.json();
    } catch {
        return NextResponse.json(
            { success: false, error: 'Muatan permintaan bukan JSON yang sah.' },
            { status: 400 },
        );
    }

    const { attemptId, answers, deviceId } = payload || {};
    if (!attemptId || !Array.isArray(answers) || answers.length === 0) {
        return NextResponse.json(
            { success: false, error: 'Payload tidak valid.' },
            { status: 400 },
        );
    }

    return proxy(request, `/students/attempts/${encodeURIComponent(attemptId)}/answers`, {
        method: 'PUT',
        body: JSON.stringify({ answers, deviceId }),
    });
}
