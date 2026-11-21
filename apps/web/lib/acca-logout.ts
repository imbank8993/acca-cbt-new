/**
 * Halaman logout bersama di ACCA New.
 *
 * CBT tidak bisa menutup sesi ACCA, Tools, atau WordPress sendiri: cookie
 * masing-masing hanya terkirim dari halaman ACCA. Halaman `/logout` ACCA
 * menjalankan logout bersama (termasuk CBT) lalu menampilkan halaman login.
 * Logout otomatis hanya bila browser datang dari aplikasi ACCA (referrer CBT).
 */
export function accaLogoutUrl(accaUrl = process.env.NEXT_PUBLIC_ACCA_URL || 'https://acca.icgowa.sch.id'): string {
    return new URL('/logout?from=cbt', accaUrl).toString();
}
