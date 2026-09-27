import { apiGet } from './client';

/**
 * Profil dan peran pemanggil, di luar identitas dasar yang sudah dibawa
 * `getSessionUser()`.
 *
 * Keduanya dulu diambil langsung dari browser lewat Supabase — `cbt_profiles`,
 * `cbt_organizations`, dan `platform_admins`. Itu jalur terakhir di `lib/rbac.ts`
 * yang menyentuh basis data dari sisi klien.
 */

export interface AccountProfile {
    id: string;
    full_name: string | null;
    identity_number: string | null;
    avatar_url: string | null;
}

export interface AccountOrganization {
    id: string;
    name: string | null;
    logo_url: string | null;
}

/** Profil dan sekolah pemanggil, untuk bilah sisi. */
export async function getAccountProfile(): Promise<{
    profile: AccountProfile | null;
    organization: AccountOrganization | null;
}> {
    const res = await apiGet<{
        profile: AccountProfile | null;
        organization: AccountOrganization | null;
    }>('/api/auth/profile');

    return res.success
        ? { profile: res.profile, organization: res.organization }
        : { profile: null, organization: null };
}
