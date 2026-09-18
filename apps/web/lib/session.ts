/**
 * Identitas pemanggil di sisi BROWSER.
 *
 * Pengganti `supabase.auth.getUser()`. Token sesi CBT disimpan di cookie
 * httpOnly `cbt_session`, jadi JavaScript halaman tidak bisa membacanya sendiri
 * — satu-satunya cara mengetahui siapa yang sedang masuk adalah bertanya ke
 * server lewat `/api/auth/me`, yang meneruskannya ke NestJS.
 *
 * Yang kembali lebih kaya daripada yang dulu diberikan Supabase: selain `id` dan
 * `email`, ada `roles`, `bestRole`, `organizationIds`, dan `isPlatformAdmin` —
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

let cached: { user: AuthUser | null; at: number } | null = null;
let inFlight: Promise<AuthUser | null> | null = null;

async function fetchMe(): Promise<AuthUser | null> {
    try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!res.ok) return null;
        const body = await res.json().catch(() => null);
        if (!body?.success || !body?.id) return null;
        return body as AuthUser;
    } catch {
        // Jaringan putus. Pemanggil memperlakukannya sama dengan "belum masuk",
        // dan middleware yang akan mengarahkan ulang bila sesinya memang habis.
        return null;
    }
}

/** Pengguna yang sedang masuk, atau null. */
export async function getSessionUser(options: { refresh?: boolean } = {}): Promise<AuthUser | null> {
    if (!options.refresh && cached && Date.now() - cached.at < TTL_MS) {
        return cached.user;
    }
    if (!options.refresh && inFlight) return inFlight;

    inFlight = fetchMe().then((user) => {
        cached = { user, at: Date.now() };
        inFlight = null;
        return user;
    });

    return inFlight;
}

/** Buang cache — dipanggil setelah sesi dihapus. */
export function clearSessionCache(): void {
    cached = null;
    inFlight = null;
}
