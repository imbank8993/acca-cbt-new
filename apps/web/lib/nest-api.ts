/**
 * Klien ke backend NestJS.
 *
 * SERVER-ONLY. Jangan pernah diimpor dari komponen `'use client'`: fungsi di
 * sini memegang `INTERNAL_API_KEY` dan token pengguna, dan `NEST_API_URL`
 * menunjuk alamat loopback yang memang tidak dapat dijangkau browser.
 *
 * Aturan yang sama dengan acca-new berlaku di sini: route handler Next.js TIDAK
 * BOLEH menyentuh database. Semua query lewat NestJS.
 */

const NEST_API_URL = process.env.NEST_API_URL || 'http://127.0.0.1:3009/api';

export interface NestResponse<T = unknown> {
    status: number;
    body: T | null;
}

function internalHeaders(): Record<string, string> {
    return { 'x-internal-key': process.env.INTERNAL_API_KEY || '' };
}

async function readBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        // Balasan bukan-JSON biasanya berasal dari reverse proxy (mis. 502 atau
        // 413), bukan dari NestJS. Isinya diteruskan sebagai pesan galat agar
        // penyebabnya tidak hilang.
        return { error: text.slice(0, 500) };
    }
}

/** Teruskan permintaan ke NestJS atas nama pengguna, memakai tokennya sendiri. */
export async function nestFetchAsUser<T = unknown>(
    path: string,
    token: string,
    init: RequestInit = {},
): Promise<NestResponse<T>> {
    try {
        const response = await fetch(`${NEST_API_URL}${path}`, {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                ...((init.headers as Record<string, string>) || {}),
                Authorization: `Bearer ${token}`,
            },
            cache: 'no-store',
        });
        return { status: response.status, body: (await readBody(response)) as T };
    } catch (error) {
        console.warn(`[nest-api] ${path} gagal:`, (error as Error).message);
        return { status: 503, body: { error: 'Backend tidak dapat dihubungi.' } as T };
    }
}

/**
 * Panggilan antar-service tanpa token pengguna, memakai shared secret.
 *
 * Hanya untuk operasi yang memang tidak punya pemanggil manusia (mis. tugas
 * terjadwal). Endpoint yang bertindak ATAS NAMA pengguna harus memakai
 * `nestFetchAsUser` supaya otorisasinya tetap ditegakkan.
 */
export async function nestFetchInternal<T = unknown>(
    path: string,
    init: RequestInit = {},
): Promise<NestResponse<T>> {
    try {
        const response = await fetch(`${NEST_API_URL}${path}`, {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                ...((init.headers as Record<string, string>) || {}),
                ...internalHeaders(),
            },
            cache: 'no-store',
        });
        return { status: response.status, body: (await readBody(response)) as T };
    } catch (error) {
        console.warn(`[nest-api] internal ${path} gagal:`, (error as Error).message);
        return { status: 503, body: { error: 'Backend tidak dapat dihubungi.' } as T };
    }
}

/** Resolusi identitas dan peran pemilik token. */
export async function fetchMe(token: string) {
    if (!token) return null;
    const { status, body } = await nestFetchAsUser('/auth/me', token);
    return status === 200 ? body : null;
}
