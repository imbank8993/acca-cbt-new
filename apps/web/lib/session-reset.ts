import { clearActiveRoleInStorage } from '@/lib/rbac';

/**
 * Buang SELURUH jejak sesi CBT di perangkat ini.
 *
 * CBT tidak punya tombol logout di mana pun, jadi sesi yang rusak — cookie yang
 * tertinggal dari build lama, token yang sudah dicabut, peran yang terkunci di
 * localStorage — tidak punya jalan keluar dari dalam aplikasi. Siswa akhirnya
 * "hanya bisa masuk lewat perangkat lain". Fungsi ini adalah jalan keluarnya:
 * bersihkan, lalu mulai hand-off SSO dari awal.
 */
export async function clearCbtSession(): Promise<void> {
    // `cbt_session` adalah cookie httpOnly: JavaScript halaman tidak bisa
    // menghapusnya sendiri. Hanya server yang bisa, lewat route logout.
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
        // Jaringan putus — lanjut bersih-bersih yang bisa dilakukan di klien.
    }

    if (typeof document !== 'undefined') {
        // Cookie `sb-*` peninggalan Supabase. Tidak ada lagi yang menerbitkannya
        // sejak cutover, tetapi perangkat yang belum pernah menyapunya masih
        // menyimpan potongan `...auth-token.0`, `.1` dari build lama.
        for (const entry of document.cookie.split(';')) {
            const name = entry.split('=')[0]?.trim();
            if (!name || !name.startsWith('sb-')) continue;
            for (const path of ['/', window.location.pathname]) {
                document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}; SameSite=Lax`;
            }
        }
    }

    try {
        clearActiveRoleInStorage();
    } catch {
        // localStorage bisa diblokir (mode privat) — abaikan.
    }
}

/**
 * Bersihkan sesi lalu ulangi hand-off dari acca-app. Dipakai oleh layar error
 * SSO supaya siswa bisa memulihkan sendiri tanpa berganti perangkat.
 */
export async function resetAndRetrySso(): Promise<void> {
    await clearCbtSession();
    const accaUrl = process.env.NEXT_PUBLIC_ACCA_URL || 'https://accav2.icgowa.sch.id';
    window.location.href = `${accaUrl}/api/sso/cbt`;
}
