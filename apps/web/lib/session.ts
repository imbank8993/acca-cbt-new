/**
 * Identitas pemanggil di sisi BROWSER.
 *
 * Pengganti `supabase.auth.getUser()`. Token sesi CBT disimpan di cookie
 * httpOnly `cbt_session`, jadi JavaScript halaman tidak bisa membacanya sendiri
 * — satu-satunya cara mengetahui siapa yang sedang masuk adalah bertanya ke
 * server lewat `/api/auth/me`, yang meneruskannya ke NestJS.
 *
 * Yang kembali lebih kaya daripada yang dulu diberikan Supabase: selain `id` dan
 * `email`, ada `roles`, `bestRole`, `organizationId`, dan `isPlatformAdmin` —
 * seluruhnya dihitung ulang NestJS dari database pada tiap permintaan. Halaman
 * yang tadinya perlu satu putaran tambahan hanya untuk mencari organisasi
 * pengguna bisa membacanya langsung dari sini.
 *
 * Nilai ini untuk MENAMPILKAN dan MENGARAHKAN, bukan untuk mengizinkan. Setiap
 * keputusan otorisasi tetap dibuat NestJS pada permintaan yang bersangkutan.
 */

import type { AuthUser } from '@acca-cbt/shared';

/**
 * Satu halaman bisa memanggil ini dari beberapa komponen sekaligus. Cache
 * pendek menyatukannya menjadi satu permintaan tanpa menahan perubahan peran
 * lebih lama daripada yang wajar.
 */
const TTL_MS = 30_000;
export const SESSION_REQUEST_TIMEOUT_MS = 10_000;

let cached: { user: AuthUser | null; at: number } | null = null;
let inFlight: Promise<AuthUser | null> | null = null;

/** Null hanya berarti server menolak sesi (401); gangguan lain melempar error. */
export async function fetchSessionUser(): Promise<AuthUser | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SESSION_REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch('/api/auth/me', {
            cache: 'no-store',
            signal: controller.signal,
        });
        if (res.status === 401) return null;
        if (!res.ok) throw new Error('Pemeriksaan sesi gagal. Silakan coba lagi.');
        const body = await res.json().catch(() => null);
        if (!body?.success || !body?.id) throw new Error('Balasan pemeriksaan sesi tidak valid.');
        return body as AuthUser;
    } finally {
        clearTimeout(timeout);
    }
}

/** Pengguna aktif, null untuk 401, atau error sementara bila belum ada cache. */
export async function getSessionUser(options: { refresh?: boolean } = {}): Promise<AuthUser | null> {
    if (!options.refresh && cached && Date.now() - cached.at < TTL_MS) {
        return cached.user;
    }
    if (!options.refresh && inFlight) return inFlight;

    const request = fetchSessionUser().then((user) => {
        if (inFlight === request) cached = { user, at: Date.now() };
        return user;
    }).catch((error: unknown) => {
        // Identitas cache hanya untuk UI; backend tetap memverifikasi akses.
        // Jangan cache kegagalan sementara sebagai sesi yang sudah berakhir.
        if (cached?.user) return cached.user;
        throw error;
    }).finally(() => {
        if (inFlight === request) inFlight = null;
    });
    inFlight = request;
    return request;
}

/** Buang cache — dipanggil setelah sesi dihapus. */
export function clearSessionCache(): void {
    cached = null;
    inFlight = null;
}
