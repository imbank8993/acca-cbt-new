import { extractRequestToken } from '@/lib/app-jwt';
import { renderEquationsToImages } from '@/lib/math-equations';
import { nestFetchAsUser } from '@/lib/nest-api';
import { proxy } from '@/lib/nest-proxy';
import { NextRequest,NextResponse } from 'next/server';

type BulkImportQuestion = Record<string, unknown> & {
    question_text?: string;
    options?: Array<Record<string, unknown>>;
};

/**
 * Impor massal soal.
 *
 * Satu-satunya route handler yang mengerjakan sesuatu sebelum meneruskan, dan
 * alasannya tunggal: persamaan MathML harus dirender menjadi SVG lalu diunggah
 * ke R2, dan hanya `apps/web` yang memegang kredensial penyimpanan. Setelah
 * langkah itu, seluruh penulisan basis data tetap dikerjakan NestJS.
 */
export async function POST(
    request: NextRequest,
    context: { params: Promise<{ bankId: string }> },
) {
    const { bankId } = await context.params;

    let payload: { questions?: BulkImportQuestion[]; clientRequestId?: string };
    try {
        payload = (await request.json()) as { questions?: BulkImportQuestion[]; clientRequestId?: string };
    } catch {
        return NextResponse.json(
            { success: false, error: 'Muatan permintaan bukan JSON yang sah.' },
            { status: 400 },
        );
    }

    const questions = payload?.questions;
    if (!Array.isArray(questions) || questions.length === 0) {
        return NextResponse.json(
            { success: false, error: 'Tidak ada soal untuk diimpor.' },
            { status: 400 },
        );
    }

    // Izin ditanyakan LEBIH DULU ke NestJS. Merender dulu baru meneruskan akan
    // membuat siapa pun yang punya sesi — termasuk siswa — bisa mengunggah SVG
    // ke prefix bank soal mana pun, karena penolakannya baru datang setelah
    // berkasnya terlanjur ditulis. Aturannya tetap hanya ada di NestJS; di sini
    // hanya hasilnya yang dibaca.
    const token = extractRequestToken(request);
    if (!token) {
        return NextResponse.json(
            { success: false, error: 'Sesi tidak valid. Silakan login ulang.' },
            { status: 401 },
        );
    }

    const permission = await nestFetchAsUser<{ error?: string }>(
        `/question-banks/${encodeURIComponent(bankId)}/import-permission`,
        token,
    );
    if (permission.status !== 200) {
        return NextResponse.json(
            { success: false, error: permission.body?.error || 'Permintaan ditolak.' },
            { status: permission.status },
        );
    }

    for (const question of questions) {
        if (typeof question.question_text === 'string') {
            question.question_text = await renderEquationsToImages(question.question_text, bankId);
        }
        for (const option of Array.isArray(question.options) ? question.options : []) {
            if (typeof option?.option_text === 'string') {
                option.option_text = await renderEquationsToImages(option.option_text, bankId);
            }
        }
    }

    return proxy(request, `/question-banks/${encodeURIComponent(bankId)}/bulk-import`, {
        method: 'POST',
        body: JSON.stringify({
            questions,
            ...(payload.clientRequestId ? { clientRequestId: payload.clientRequestId } : {}),
        }),
    });
}
