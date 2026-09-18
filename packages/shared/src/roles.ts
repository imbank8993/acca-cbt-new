/**
 * Definisi peran yang dipakai BERSAMA oleh apps/web dan apps/api.
 *
 * Sebelumnya konstanta ini hanya ada di `apps/web/lib/rbac.ts`. Setelah
 * otorisasi pindah ke NestJS, dua salinan yang bisa berbeda diam-diam adalah
 * risiko nyata: daftar superadmin yang tidak sinkron berarti seseorang lolos di
 * satu sisi dan ditolak di sisi lain.
 */

export type DashboardRole =
  | 'Siswa'
  | 'Proktor'
  | 'Guru'
  | 'Pengawas'
  | 'Admin'
  | 'Superadmin'
  | 'None';

/**
 * Email yang diberi hak Superadmin. Superadmin dapat mengelola semua sekolah
 * (termasuk menambah Admin baru); Admin biasa tidak bisa menambah Admin lain.
 */
export const SUPERADMIN_EMAILS: readonly string[] = [
  'imbank8993@gmail.com',
];

export const ROLE_PRIORITY: Record<DashboardRole, number> = {
  Superadmin: 110,
  Admin: 100,
  Proktor: 80,
  Guru: 70,
  Pengawas: 60,
  Siswa: 50,
  None: 0,
};

export const ROLE_TO_DASHBOARD_PATH: Record<DashboardRole, string> = {
  Siswa: '/dashboard/siswa',
  Proktor: '/dashboard/proktor',
  Guru: '/dashboard/guru',
  Pengawas: '/dashboard/pengawas',
  Admin: '/dashboard/admin',
  Superadmin: '/dashboard/admin',
  None: '/',
};

/** Kanonisasi nama peran dari database/token (tidak peka huruf besar-kecil). */
export const ROLE_NAME_CANON: Record<string, DashboardRole> = {
  SUPERADMIN: 'Superadmin',
  SUPER_ADMIN: 'Superadmin',
  ADMIN: 'Admin',
  PROKTOR: 'Proktor',
  GURU: 'Guru',
  PENGAWAS: 'Pengawas',
  SISWA: 'Siswa',
};

export interface ResolvedUserRoles {
  siswa: boolean;
  proktor: boolean;
  guru: boolean;
  pengawas: boolean;
  admin: boolean;
  superadmin: boolean;
}

export function emptyResolvedRoles(): ResolvedUserRoles {
  return {
    siswa: false,
    proktor: false,
    guru: false,
    pengawas: false,
    admin: false,
    superadmin: false,
  };
}

/** Peran terbaik yang memenuhi syarat: Superadmin > Admin > Proktor > Guru > Pengawas > Siswa. */
export function pickBestRole(roles: ResolvedUserRoles): DashboardRole {
  if (roles.superadmin) return 'Superadmin';
  if (roles.admin) return 'Admin';
  if (roles.proktor) return 'Proktor';
  if (roles.guru) return 'Guru';
  if (roles.pengawas) return 'Pengawas';
  if (roles.siswa) return 'Siswa';
  return 'None';
}

export function isSuperadminEmail(email: string | null | undefined): boolean {
  const normalized = (email || '').toLowerCase();
  return SUPERADMIN_EMAILS.some((e) => e.toLowerCase() === normalized);
}
