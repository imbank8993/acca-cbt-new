import type { DashboardRole, ResolvedUserRoles } from './roles';

/**
 * Bentuk balasan yang dipakai seluruh route handler.
 *
 * Sengaja dibuat sama dengan bentuk yang sudah dikembalikan server action lama
 * (`{ success, ... }`) — 495 titik pemanggilan di frontend sudah membacanya
 * seperti itu, jadi migrasi tidak perlu mengubah cara penanganan galat.
 */
export type ApiResult<T> =
  | ({ success: true } & T)
  | { success: false; error: string };

/** Identitas pemanggil hasil verifikasi JWT di NestJS. */
export interface AuthUser {
  /** UUID `auth.users.id` — kunci yang dirujuk `cbt_profiles.id`. */
  id: string;
  email: string;
  fullName: string | null;
  /** Nama peran dalam huruf besar, mis. ['GURU', 'PROKTOR']. */
  roles: string[];
  resolved: ResolvedUserRoles;
  bestRole: DashboardRole;
  /** Sekolah tunggal instalasi, ditentukan server dari database. */
  organizationId: string;
  /** Nama sekolah tunggal untuk tampilan; tidak dipakai sebagai scope otorisasi. */
  organizationName: string;
  isPlatformAdmin: boolean;
}

export interface LoginResponse {
  access_token: string;
  token_type: 'Bearer';
  user: AuthUser;
}
