import { getRoleContexts } from './api/account';
import { getSessionUser } from './session';

export type DashboardRole = 'Siswa' | 'Proktor' | 'Guru' | 'Pengawas' | 'Admin' | 'Superadmin' | 'None';

/**
 * Emails granted Superadmin rights. A Superadmin can manage all schools
 * (including adding new Admins). A regular Admin (also in `platform_admins`)
 * cannot add other Admins.
 *
 * Keep this list in sync with any DB migration that introduces a
 * `platform_admins.is_superadmin` column.
 */
export const SUPERADMIN_EMAILS: readonly string[] = [
    'imbank8993@gmail.com',
];

export const ACTIVE_ROLE_STORAGE_KEY = 'acca_active_role_v2';
export const ACTIVE_ROLE_LOCK_KEY = 'acca_active_role_locked_v2';

export const ROLE_PRIORITY: Record<DashboardRole, number> = {
    'Superadmin': 110,
    'Admin': 100,
    'Proktor': 80,
    'Guru': 70,
    'Pengawas': 60,
    'Siswa': 50,
    'None': 0,
};

export const ROLE_TO_DASHBOARD_PATH: Record<DashboardRole, string> = {
    'Siswa': '/dashboard/siswa',
    'Proktor': '/dashboard/proktor',
    'Guru': '/dashboard/guru',
    'Pengawas': '/dashboard/pengawas',
    'Admin': '/dashboard/admin',
    'Superadmin': '/dashboard/admin',
    'None': '/',
};

/** Kanonisasi nama role dari DB/metadata (case-insensitive) → DashboardRole. */
export const ROLE_NAME_CANON: Record<string, DashboardRole> = {
    'SUPERADMIN': 'Superadmin',
    'SUPER_ADMIN': 'Superadmin',
    'ADMIN': 'Admin',
    'PROKTOR': 'Proktor',
    'GURU': 'Guru',
    'PENGAWAS': 'Pengawas',
    'SISWA': 'Siswa',
};

export const PATH_TO_DEFAULT_ROLE: { prefix: string; role: DashboardRole }[] = [
    { prefix: '/dashboard/admin', role: 'Admin' },
    { prefix: '/dashboard/proktor', role: 'Proktor' },
    { prefix: '/dashboard/guru', role: 'Guru' },
    { prefix: '/dashboard/pengawas', role: 'Pengawas' },
    { prefix: '/dashboard/siswa', role: 'Siswa' },
];

/**
 * Read the role the user is currently viewing from sessionStorage.
 * This is the AUTHORITATIVE "active role" for navigation purposes:
 *  - Set when the user explicitly picks a role (login redirect, role switcher)
 *  - Sticky for the tab session to avoid race conditions across refresh
 *  - Cleared on logout / sign-in to a different account
 */
export function getActiveRoleFromStorage(): DashboardRole | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(ACTIVE_ROLE_STORAGE_KEY);
        if (!raw) return null;
        if (Object.prototype.hasOwnProperty.call(ROLE_TO_DASHBOARD_PATH, raw)) {
            return raw as DashboardRole;
        }
        return null;
    } catch {
        return null;
    }
}

export function setActiveRoleInStorage(role: DashboardRole): void {
    if (typeof window === 'undefined') return;
    try {
        if (role && role !== 'None') {
            localStorage.setItem(ACTIVE_ROLE_STORAGE_KEY, role);
        } else {
            localStorage.removeItem(ACTIVE_ROLE_STORAGE_KEY);
        }
    } catch {
        /* ignore quota / privacy errors */
    }
}

export function clearActiveRoleInStorage(): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.removeItem(ACTIVE_ROLE_STORAGE_KEY);
        localStorage.removeItem(ACTIVE_ROLE_LOCK_KEY);
    } catch {
        /* ignore */
    }
}

/**
 * Lock the active role for this tab so a refresh cannot re-derive a different role
 * (which is the root cause of the Siswa/Proktor confusion).
 * The lock is released when the user explicitly switches roles or signs out.
 */
export function isActiveRoleLocked(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return localStorage.getItem(ACTIVE_ROLE_LOCK_KEY) === '1';
    } catch {
        return false;
    }
}

export function lockActiveRole(): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(ACTIVE_ROLE_LOCK_KEY, '1');
    } catch {
        /* ignore */
    }
}

export function unlockActiveRole(): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.removeItem(ACTIVE_ROLE_LOCK_KEY);
    } catch {
        /* ignore */
    }
}

/**
 * Detect the role from the current URL path. Used as a fallback when
 * sessionStorage is empty (e.g. deep-link to a sub-page after login).
 */
export function getRoleFromPath(pathname: string | null | undefined): DashboardRole | null {
    if (!pathname) return null;
    for (const { prefix, role } of PATH_TO_DEFAULT_ROLE) {
        if (pathname.startsWith(prefix)) return role;
    }
    return null;
}

export interface ResolvedUserRoles {
    siswa: boolean;
    proktor: boolean;
    guru: boolean;
    pengawas: boolean;
    admin: boolean;
    superadmin: boolean;
}

/**
 * Pick the best role for the user given their actual qualifications.
 * Superadmin > Admin > Proktor > Guru > Pengawas > Siswa.
 */
export function pickBestRole(roles: ResolvedUserRoles): DashboardRole {
    if (roles.superadmin) return 'Superadmin';
    if (roles.admin) return 'Admin';
    if (roles.proktor) return 'Proktor';
    if (roles.guru) return 'Guru';
    if (roles.pengawas) return 'Pengawas';
    if (roles.siswa) return 'Siswa';
    return 'None';
}

/**
 * SINGLE SOURCE OF TRUTH for the dashboard a user should land on / currently see.
 *
 * Resolution order:
 *   1. sessionStorage['acca_active_role_v1']  (sticky, survives refresh)
 *   2. URL path  (deep-link, role-switcher navigation)
 *   3. Best qualified role (computed from memberships / subscriptions)
 *
 * The chosen role is written back to sessionStorage so subsequent refreshes
 * stay on the same dashboard. This is the fix for the Siswa↔Proktor flicker.
 */
export async function resolveActiveRole(opts?: {
    pathname?: string | null;
    forceRefresh?: boolean;
}): Promise<{ role: DashboardRole; resolvedBy: 'storage' | 'path' | 'qualifications' | 'none' }> {
    // Peran dihitung NestJS dari database pada tiap permintaan `/auth/me`,
    // dengan query yang sama yang dulu dijalankan di browser. Menghitungnya di
    // sini lagi hanya menambah satu sumber kebenaran kedua yang bisa berbeda.
    const user = await getSessionUser({ refresh: opts?.forceRefresh });
    if (!user) {
        return { role: 'None', resolvedBy: 'none' };
    }

    const roles: ResolvedUserRoles = { ...user.resolved };

    if (SUPERADMIN_EMAILS.map(e => e.toLowerCase()).includes((user.email || '').toLowerCase())) {
        roles.superadmin = true;
    }

    const best = pickBestRole(roles);
    if (best !== 'None') {
        return { role: best, resolvedBy: 'qualifications' };
    }

    return { role: 'None', resolvedBy: 'none' };
}

function isRoleQualified(roles: ResolvedUserRoles, role: DashboardRole): boolean {
    switch (role) {
        case 'Superadmin': return roles.superadmin;
        case 'Admin': return roles.admin;
        case 'Proktor': return roles.proktor;
        case 'Guru': return roles.guru;
        case 'Pengawas': return roles.pengawas;
        case 'Siswa': return roles.siswa;
        default: return false;
    }
}

/**
 * Check whether a user is qualified for a given role based on a
 * `UserRoleContext[]` list (the output of `getUserRolesWithOrg`).
 * Used by the dashboard layout to decide if a URL path is reachable
 * for the current user.
 *
 * Special cases:
 *  - A Superadmin is treated as qualified for the Admin path (both share
 *    /dashboard/admin), so the layout does not redirect them away from
 *    /dashboard/admin when their resolved role is 'Superadmin'.
 */
export function isRoleQualifiedFromList(
    list: UserRoleContext[],
    role: DashboardRole,
): boolean {
    if (list.some((ctx) => ctx.role === role)) return true;
    if (list.some((ctx) => ctx.role === 'Superadmin' || ctx.role === 'Admin')) return true;
    return false;
}

/**
 * Legacy alias used by older code paths. Prefer `resolveActiveRole`.
 */
export async function getUserRole(): Promise<DashboardRole | null> {
    const user = await getSessionUser();
    if (!user) return null;
    const best = pickBestRole(user.resolved);
    return best === 'None' ? null : best;
}

export function getDashboardPath(role: DashboardRole): string {
    return ROLE_TO_DASHBOARD_PATH[role] ?? '/';
}

/**
 * Called when a user explicitly switches roles (e.g. from the sidebar's role
 * switcher). Updates the locked active role and returns the path to navigate to.
 */
export function switchActiveRole(target: DashboardRole, roles?: ResolvedUserRoles): string {
    if (target === 'None') return ROLE_TO_DASHBOARD_PATH[target];
    if (roles && !isRoleQualified(roles, target)) {
        // Refuse to switch to a role the user does not actually have.
        return ROLE_TO_DASHBOARD_PATH[pickBestRole(roles)];
    }
    setActiveRoleInStorage(target);
    lockActiveRole();
    return ROLE_TO_DASHBOARD_PATH[target];
}

// ================================================================
// Backward-compatible shims for older call sites.
// Prefer resolveActiveRole / resolveUserRoles in new code.
// ================================================================

/** Legacy type alias. Use DashboardRole in new code. */
export type Role = DashboardRole;

export interface UserRoleContext {
    role: Role;
    orgId: string;
    orgName: string;
}

/**
 * Seluruh peran pengguna pada sekolah tunggal instalasi ini.
 *
 * Perhitungannya kini di NestJS. Versi lama menyusunnya di BROWSER dari
 * `platform_admins`, `cbt_organization_members`, dan metadata pengguna — jalur
 * terakhir di berkas ini yang menyentuh basis data langsung, dan satu-satunya
 * yang menahan seluruh modul rbac tetap bergantung pada Supabase.
 *
 * `userId` tidak lagi diterima: peran selalu untuk pemilik sesi.
 */
export async function getUserRolesWithOrg(): Promise<UserRoleContext[]> {
    return getRoleContexts();
}

/**
 * Compatibility helper for the landing redirect. Siswa tetap berada pada
 * sekolah tunggal yang sama seperti peran lain.
 */
export function isPersonalRole(role: Role | null | undefined): boolean {
    return role === 'Siswa';
}
