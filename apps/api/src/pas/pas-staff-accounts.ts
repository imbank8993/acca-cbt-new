import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { DbService, DbSession } from '../prisma/prisma-db-adapter';

type StaffDb = Pick<DbService, 'from'> | DbSession;

interface AccaStaffAccount {
    auth_id: string | null;
    nama_lengkap: string | null;
    nama: string | null;
    nip: string | null;
    email: string | null;
    role: string | null;
}

const INVIGILATOR_ROLES = new Set([
    'GURU', 'TU', 'TENDIK', 'STAF', 'STAFF', 'PROKTOR', 'ADMIN',
    'KAMAD', 'KEPALA MADRASAH', 'PENGAWAS', 'PENGAWAS_MADRASAH',
]);

function staffRoles(role: string | null): string[] {
    return String(role || '').split(',').map(value => value.trim().toUpperCase()).filter(Boolean);
}

function eligibleStaff(account: AccaStaffAccount): boolean {
    return Boolean(account.auth_id && (account.nama_lengkap?.trim() || account.nama?.trim())
        && staffRoles(account.role).some(role => INVIGILATOR_ROLES.has(role)));
}

/** Akun ACCA aktif dapat ditugaskan sebelum login CBT pertama. */
export async function listAccaInvigilatorAccounts(db: StaffDb): Promise<AccaStaffAccount[]> {
    const { data, error } = await db.from('users')
        .select('auth_id, nama_lengkap, nama, nip, email, role')
        .eq('aktif', true);
    if (error) throw new ServiceUnavailableException('Daftar guru dan staf belum dapat dimuat. Silakan coba lagi.');
    return ((data as AccaStaffAccount[]) || []).filter(eligibleStaff);
}

export async function inactiveAccaAccountIds(db: StaffDb, userIds: string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const { data, error } = await db.from('users').select('auth_id')
        .eq('aktif', false).in('auth_id', userIds);
    if (error) throw new ServiceUnavailableException('Status akun guru dan staf belum dapat diperiksa.');
    return new Set(((data as Array<{ auth_id: string }>) || []).map(account => account.auth_id));
}

export function staffAccountView(account: AccaStaffAccount) {
    return {
        id: account.auth_id!,
        name: (account.nama_lengkap || account.nama || '').trim(),
        nip: account.nip?.trim() || account.email?.trim() || null,
        roles: staffRoles(account.role).map(role => role === 'TU' ? 'Tendik' : role === 'GURU' ? 'Guru' : role),
    };
}

/** Buat profil dan keanggotaan hanya untuk akun ACCA yang aktif dan belum terdaftar. */
export async function ensureAccaInvigilatorMembers(db: DbSession, organizationId: string, userIds: string[]): Promise<void> {
    if (!userIds.length) return;
    if ((await inactiveAccaAccountIds(db, userIds)).size) {
        throw new BadRequestException('Akun ACCA pengawas yang dipilih sudah nonaktif.');
    }
    const { data: members, error: memberError } = await db.from('cbt_organization_members')
        .select('user_id').eq('organization_id', organizationId).in('user_id', userIds);
    if (memberError) throw new BadRequestException('Keanggotaan pengawas belum dapat diperiksa.');
    const existing = new Set(((members as Array<{ user_id: string }>) || []).map(member => member.user_id));
    const missing = userIds.filter(id => !existing.has(id));
    if (!missing.length) return;

    const accounts = await listAccaInvigilatorAccounts(db);
    const byId = new Map(accounts.map(account => [account.auth_id!, account]));
    if (missing.some(id => !byId.has(id))) {
        throw new BadRequestException('Pengawas yang dipilih harus memiliki akun ACCA aktif sebagai guru atau staf/tendik.');
    }

    const { data: profiles, error: profileError } = await db.from('cbt_profiles')
        .select('id').in('id', missing);
    if (profileError) throw new BadRequestException('Profil pengawas belum dapat diperiksa.');
    const profileIds = new Set(((profiles as Array<{ id: string }>) || []).map(profile => profile.id));
    for (const id of missing) {
        const account = byId.get(id)!;
        if (!profileIds.has(id)) {
            const { error } = await db.from('cbt_profiles').upsert({
                id,
                full_name: (account.nama_lengkap || account.nama || '').trim(),
                identity_number: account.nip?.trim() || account.email?.trim() || null,
            }, { onConflict: 'id' });
            if (error) throw new BadRequestException('Profil pengawas belum dapat disiapkan.');
        }
        // Anggota yang sudah ada (termasuk yang nonaktif) dilewati di atas.
        const { error } = await db.from('cbt_organization_members')
            .upsert({ organization_id: organizationId, user_id: id, is_active: true }, { onConflict: 'organization_id,user_id' });
        if (error) throw new BadRequestException('Keanggotaan pengawas belum dapat disiapkan.');
    }
}
