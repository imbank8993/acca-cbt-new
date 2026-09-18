import { NextRequest, NextResponse } from 'next/server';
import { extractRequestToken } from '@/lib/app-jwt';
import { nestFetchAsUser } from '@/lib/nest-api';

/**
 * Helper terpusat untuk meneruskan permintaan route handler Next.js ke NestJS.
 *
 * Inilah bentuk baku setiap endpoint di `app/api/**` setelah migrasi. Route
 * handler hanya mengambil token dari cookie lalu meneruskan; seluruh logika dan
 * otorisasi ada di NestJS.
 *
 *   export async function POST(request: NextRequest) {
 *       return proxy(request, '/exams', { method: 'POST', body: await request.text() });
 *   }
 */
export async function proxy(
    request: NextRequest,
    path: string,
    init: RequestInit = {},
): Promise<NextResponse> {
    const token = extractRequestToken(request);
    if (!token) {
        return NextResponse.json(
            { success: false, error: 'Sesi tidak valid. Silakan login ulang.' },
            { status: 401 },
        );
    }

    const { status, body } = await nestFetchAsUser<Record<string, unknown>>(path, token, init);

    if (status < 200 || status >= 300) {
        // Pesan dari NestJS diteruskan apa adanya: ia ditulis untuk pengguna
        // (mis. "Masih ada 3 peserta dengan esai yang belum dinilai"), dan
        // menggantinya dengan pesan umum justru menghilangkan petunjuk yang
        // dibutuhkan guru.
        const message =
            (body?.error as string) || (body?.message as string) || 'Permintaan gagal.';
        return NextResponse.json({ success: false, error: message }, { status });
    }

    return NextResponse.json(withSuccess(body), { status });
}

/**
 * Sisipkan `success: true` ke balasan yang berhasil.
 *
 * Seluruh frontend membaca bentuk `{ success, ... }` — 495 titik pemanggilan —
 * jadi kontraknya dipertahankan. Tetapi controller NestJS tetap mengembalikan
 * muatan domain yang bersih (`{ settings: [...] }`), bukan menyalin bentuk
 * pembungkus ini ke setiap endpoint. Penyatuannya cukup di satu tempat: di sini.
 *
 * Konvensinya: controller SELALU mengembalikan objek, tidak pernah array
 * telanjang, supaya penamaan datanya jelas dan ada tempat menyisipkan `success`.
 */
function withSuccess(body: unknown): Record<string, unknown> {
    if (body === null || body === undefined) return { success: true };
    if (Array.isArray(body)) return { success: true, data: body };
    if (typeof body !== 'object') return { success: true, data: body };

    const record = body as Record<string, unknown>;
    return 'success' in record ? record : { success: true, ...record };
}

/** Bentuk singkat untuk endpoint GET tanpa body. */
export function proxyGet(request: NextRequest, path: string): Promise<NextResponse> {
    return proxy(request, path, { method: 'GET' });
}

/** Teruskan body JSON permintaan apa adanya ke NestJS. */
export async function proxyJson(
    request: NextRequest,
    path: string,
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST',
): Promise<NextResponse> {
    const body = await request.text();
    return proxy(request, path, { method, body: body || undefined });
}
