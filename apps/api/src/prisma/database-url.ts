/**
 * Lengkapi DATABASE_URL dengan ukuran pool koneksi Prisma yang layak untuk ujian.
 *
 * Tanpa `connection_limit`, Prisma memakai (2 x jumlah core fisik + 1) koneksi —
 * sekitar 13 di VPS 6 core. Saat ratusan siswa mengumpulkan ujian serentak, pool
 * sekecil itu habis sehingga autosave, heartbeat, dan pengumpulan siswa lain
 * gagal menunggu koneksi. Nilai yang sudah ditulis eksplisit di DATABASE_URL
 * selalu dihormati; bawaan ini hanya mengisi yang kosong.
 *
 * Dapat diatur lewat env:
 *   DB_CONNECTION_LIMIT (bawaan 30) — pastikan di bawah `max_connections`
 *     PostgreSQL dikurangi kebutuhan aplikasi lain (mis. acca-new).
 *   DB_POOL_TIMEOUT     (bawaan 20 detik) — lama query menunggu koneksi kosong.
 *
 * String URL tidak di-parse ulang supaya kata sandi dengan karakter khusus tidak
 * berubah; parameter hanya ditambahkan di ujung.
 */
export const DEFAULT_DB_CONNECTION_LIMIT = 30;
export const DEFAULT_DB_POOL_TIMEOUT_SECONDS = 20;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function withPoolDefaults(
  url: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (!url) return url;

  const additions: string[] = [];
  if (!/[?&]connection_limit=/i.test(url)) {
    additions.push(
      `connection_limit=${positiveInt(env.DB_CONNECTION_LIMIT, DEFAULT_DB_CONNECTION_LIMIT)}`,
    );
  }
  if (!/[?&]pool_timeout=/i.test(url)) {
    additions.push(
      `pool_timeout=${positiveInt(env.DB_POOL_TIMEOUT, DEFAULT_DB_POOL_TIMEOUT_SECONDS)}`,
    );
  }
  if (additions.length === 0) return url;

  const hashIndex = url.indexOf('#');
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
  const separator = base.includes('?') ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?';
  return `${base}${separator}${additions.join('&')}${hash}`;
}
