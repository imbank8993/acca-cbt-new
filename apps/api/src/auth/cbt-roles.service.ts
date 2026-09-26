import { Injectable, Logger } from '@nestjs/common';
import {
  emptyResolvedRoles,
  isSuperadminEmail,
  pickBestRole,
  type DashboardRole,
  type ResolvedUserRoles,
} from '@acca-cbt/shared';
import { DbService } from '../prisma/prisma-db-adapter';
import { SingleSchoolService } from './single-school.service';

export interface UserRoleContext {
  resolved: ResolvedUserRoles;
  bestRole: DashboardRole;
  roleNames: string[];
  organizationId: string;
  isPlatformAdmin: boolean;
}

/**
 * Penentuan peran CBT, dipindahkan dari `apps/web/lib/rbac.ts`.
 *
 * Perbedaan penting dengan versi lama: fungsi ini dipanggil dengan UUID hasil
 * verifikasi token, bukan `userId` yang dikirim browser. Di kode lama, 62 server
 * action menerima `userId` sebagai parameter biasa — siapa pun yang tahu UUID
 * orang lain bisa meminta data atas namanya.
 */
@Injectable()
export class CbtRolesService {
  private readonly logger = new Logger(CbtRolesService.name);

  constructor(
    private readonly db: DbService,
    private readonly schoolScope: SingleSchoolService,
  ) {}

  /**
   * Galat query sengaja ditelan: tabel `platform_admins` belum tentu ada di
   * setiap lingkungan, dan ketiadaannya tidak boleh membuat seluruh penentuan
   * peran gagal.
   */
  private async optional<T>(
    // PromiseLike, bukan Promise: PostgrestQueryBuilder hanya mengimplementasikan
    // `then` agar bisa langsung di-await seperti klien Supabase, dan tidak punya
    // `catch` maupun `finally`.
    run: () => PromiseLike<{ data: T; error: unknown }>,
  ): Promise<T | null> {
    try {
      const { data, error } = await run();
      if (error) return null;
      return data;
    } catch {
      return null;
    }
  }

  async resolve(
    userId: string,
    email: string,
    userMetadata: Record<string, unknown> | null = null,
  ): Promise<UserRoleContext> {
    const out = emptyResolvedRoles();
    const school = await this.schoolScope.getSchool();
    const organizationId = school.id;
    let isPlatformAdmin = false;

    // Peran dari metadata akun. Dipertahankan karena tiket SSO acca-app menulis
    // peran sekolah ke sini saat pengguna pertama kali masuk.
    const metaRole = String((userMetadata?.role as string) || '').toUpperCase();
    const metaRoleList = Array.isArray(userMetadata?.roles)
      ? (userMetadata?.roles as string[]).map((r) => String(r).toUpperCase())
      : [];
    const metaRoles = new Set([metaRole, ...metaRoleList].filter(Boolean));

    if (isSuperadminEmail(email)) {
      out.superadmin = true;
      isPlatformAdmin = true;
    } else if (metaRoles.has('SUPER_ADMIN') || metaRoles.has('SUPERADMIN')) {
      out.superadmin = true;
    } else if (metaRoles.has('ADMIN')) {
      out.admin = true;
    }

    const [memberships, platformAdmin, attempt] = await Promise.all([
        this.optional(() =>
          this.db
            .from('cbt_organization_members')
            .select(
              'id, organization_id, is_active, member_roles:cbt_member_roles(role_id, roles:cbt_roles(name))',
            )
            .eq('user_id', userId)
            .eq('organization_id', school.id)
            .eq('is_active', true),
        ),
        out.superadmin
          ? Promise.resolve(null)
          : this.optional(() =>
              this.db
                .from('platform_admins')
                .select('id, email')
                .eq('id', userId)
                .maybeSingle(),
            ),
        this.optional(() =>
          this.db.from('cbt_exam_attempts').select('id').eq('user_id', userId).limit(1).maybeSingle(),
        ),
      ]);

    const orgRoleNames = new Set<string>();

    for (const member of (memberships as any[]) || []) {
      for (const memberRole of member.member_roles || []) {
        const name = memberRole?.roles?.name;
        // Dinormalkan ke huruf besar agar 'Proktor'/'PROKTOR'/'proktor' di
        // cbt_roles.name terbaca sama.
        if (name) orgRoleNames.add(String(name).toUpperCase());
      }
    }

    if (!out.superadmin && !out.admin && platformAdmin) {
      isPlatformAdmin = true;
      const adminEmail = (platformAdmin as { email?: string }).email;
      if (isSuperadminEmail(adminEmail)) out.superadmin = true;
      else out.admin = true;
    }

    if (orgRoleNames.has('PROKTOR') || metaRoles.has('PROKTOR')) out.proktor = true;
    if (orgRoleNames.has('ADMIN')) out.admin = true;
    if (orgRoleNames.has('GURU') || metaRoles.has('GURU')) out.guru = true;
    if (orgRoleNames.has('PENGAWAS') || metaRoles.has('PENGAWAS')) out.pengawas = true;
    if (orgRoleNames.has('SISWA') || metaRoles.has('SISWA')) out.siswa = true;

    // Pernah mengikuti ujian sudah cukup untuk peran Siswa: akun lama bisa
    // kehilangan keanggotaan organisasi tetapi tetap perlu membuka riwayat
    // nilainya.
    if (!out.siswa && attempt) out.siswa = true;

    const roleNames = [
      ...orgRoleNames,
      ...(out.superadmin ? ['SUPERADMIN'] : []),
      ...(out.admin ? ['ADMIN'] : []),
    ];

    return {
      resolved: out,
      bestRole: pickBestRole(out),
      roleNames: [...new Set(roleNames)],
      organizationId,
      isPlatformAdmin,
    };
  }

  /** Apakah pengguna memegang salah satu peran di organisasi tertentu. */
  async hasOrgRole(
    userId: string,
    organizationId: string | null | undefined,
    roles: string[],
  ): Promise<boolean> {
    if (!organizationId) return false;
    const schoolId = await this.schoolScope.assertSchoolId(organizationId);
    const wanted = new Set(roles.map((r) => r.toUpperCase()));

    const { data } = await this.db
      .from('cbt_organization_members')
      .select('id, member_roles:cbt_member_roles(roles:cbt_roles(name))')
      .eq('user_id', userId)
      .eq('organization_id', schoolId)
      .eq('is_active', true);

    for (const member of (data as any[]) || []) {
      for (const memberRole of member.member_roles || []) {
        const name = memberRole?.roles?.name;
        if (name && wanted.has(String(name).toUpperCase())) return true;
      }
    }
    return false;
  }
}
