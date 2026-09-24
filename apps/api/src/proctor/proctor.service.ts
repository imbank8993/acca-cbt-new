import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthUsersRepository } from '../auth/auth-users.repository';
import { AuthorizationService } from '../auth/authorization.service';
import { DbService } from '../prisma/prisma-db-adapter';

/** Format tahun ajaran yang diterima, mis. `2025/2026`. */
const SCHOOL_YEAR_PATTERN = /^\d{4}\/\d{4}$/;

/** Kode galat PostgreSQL untuk pelanggaran batasan unik. */
const UNIQUE_VIOLATION = '23505';

/**
 * Peran ditampilkan menurut prioritas: seorang guru yang juga proktor
 * diperlihatkan sebagai Proktor, bukan sebagai dua baris.
 */
const ROLE_PRIORITY = [
    'SUPER_ADMIN',
    'SUPERADMIN',
    'ADMIN',
    'PROKTOR',
    'GURU',
    'PENGAWAS',
    'SISWA',
];

const ROLE_LABEL: Record<string, string> = {
    SUPER_ADMIN: 'Admin',
    SUPERADMIN: 'Admin',
    ADMIN: 'Admin',
    PROKTOR: 'Proktor',
    GURU: 'Guru',
    PENGAWAS: 'Pengawas',
    SISWA: 'Siswa',
};

/**
 * Dasbor staf: organisasi, ringkasan angka, riwayat masuk, tahun ajaran, dan
 * mata pelajaran.
 *
 * Dipindahkan dari `apps/web/app/actions/proktor.ts` — berkas terbesar dalam
 * migrasi ini, 45 aksi. Tujuh belas di antaranya TIDAK ikut pindah karena tidak
 * punya satu pun pemanggil: seluruh pengelolaan anggota (undang, hapis, ubah
 * profil, ubah status), impor anggota/mapel/tahun ajaran, penutupan otomatis
 * terjadwal, dan pengelolaan mapel milik CBT sendiri. Sebagiannya kembar dengan
 * modul lain yang sudah dipindahkan lebih dulu.
 */
@Injectable()
export class ProctorService {
    private readonly logger = new Logger(ProctorService.name);

    constructor(
        private readonly db: DbService,
        private readonly authz: AuthorizationService,
        private readonly authUsers: AuthUsersRepository,
    ) {}

    /**
     * Organisasi konteks untuk dasbor staf.
     *
     * Pemasangan ini SATU sekolah: ada tepat satu organisasi, dan peran staf
     * berasal dari metadata pengguna, bukan dari keanggotaan
     * `cbt_organization_members` yang nyaris tidak dipakai di sini. Karena itu
     * yang dikembalikan selalu satu-satunya organisasi yang ada.
     */
    async getOrganization() {
        const { data } = await this.db
            .from('cbt_organizations')
            .select('id, name')
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();

        return (data as { id: string; name: string } | null) ?? null;
    }

    /** Angka ringkas untuk kartu dasbor. */
    async getStats(user: AuthUser, organizationId: string) {
        await this.authz.assertOrgMonitoring(user, organizationId);

        const empty = {
            totalMembers: 0,
            totalBanks: 0,
            ongoingExams: 0,
            draftExams: 0,
            finishedExams: 0,
        };

        const [members, banks, exams] = await Promise.all([
            this.db
                .from('cbt_organization_members')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', organizationId),
            this.db
                .from('cbt_question_banks')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', organizationId),
            this.db
                .from('cbt_exams')
                .select('is_published, status, start_time, end_time')
                .eq('organization_id', organizationId),
        ]);

        const rows =
            (exams.data as Array<{
                is_published: boolean | null;
                status: string | null;
                start_time: string | null;
                end_time: string | null;
            }>) || [];

        // Waktu dibandingkan sebagai epoch, BUKAN sebagai string. Kolom
        // timestamptz diserialisasi dengan offset zona database
        // ("2026-07-06T13:00:00+08:00") sementara `toISOString()` menghasilkan
        // akhiran "Z" — membandingkan keduanya secara leksikografis selalu
        // keliru, dan gejalanya adalah "ujian aktif: 0" saat ujian berlangsung.
        const now = Date.now();
        const ms = (value: string | null) => (value ? new Date(value).getTime() : NaN);

        const withinWindow = (exam: (typeof rows)[number]) =>
            (!exam.start_time || ms(exam.start_time) <= now) &&
            (!exam.end_time || ms(exam.end_time) >= now);

        return {
            ...empty,
            totalMembers: members.count || 0,
            totalBanks: banks.count || 0,
            draftExams: rows.filter((e) => !e.is_published).length,
            ongoingExams: rows.filter(
                (e) => e.is_published && e.status === 'active' && withinWindow(e),
            ).length,
            finishedExams: rows.filter(
                (e) =>
                    e.status === 'finished' ||
                    (e.is_published &&
                        e.status === 'active' &&
                        e.end_time &&
                        ms(e.end_time) < now),
            ).length,
        };
    }

    /**
     * Peran pemanggil, untuk menentukan menu apa yang ditampilkan.
     *
     * Tidak menerima `userId`: versi lama menerimanya dari browser, sehingga
     * layar bisa dibuat menampilkan menu proktor hanya dengan mengirim UUID
     * seorang proktor. Peran sebenarnya sudah diselesaikan saat token dibuat.
     */
    resolveRoles(user: AuthUser) {
        const names = new Set((user.roles || []).map((role) => String(role).toUpperCase()));
        if (user.isPlatformAdmin || user.resolved?.superadmin === true) {
            names.add('SUPER_ADMIN');
        }

        const isProctor =
            names.has('PROKTOR') || names.has('ADMIN') || names.has('SUPER_ADMIN');

        return {
            roles: [...names],
            isProctor,
            isGuru: names.has('GURU'),
            hasDualRole: isProctor && names.has('GURU'),
        };
    }

    /**
     * Anggota organisasi beserta waktu masuk terakhirnya.
     *
     * Kolom `last_login_at` memang tidak ada di `cbt_organization_members`:
     * waktu masuk dicatat otentikasi di `auth.users.last_sign_in_at`, jadi
     * daftarnya dibaca dari sini lalu diperkaya dari sana.
     */
    async getRecentLogins(user: AuthUser, organizationId: string, limit: number) {
        await this.authz.assertOrgStaff(user, organizationId);

        const { data, error } = await this.db
            .from('cbt_organization_members')
            .select(
                `id, user_id, is_active,
                 profiles:cbt_profiles(id, full_name, avatar_url),
                 member_roles:cbt_member_roles(roles:cbt_roles(name))`,
            )
            .eq('organization_id', organizationId);

        if (error) {
            this.logger.error(`Gagal membaca daftar anggota: ${error.message}`);
            return [];
        }

        const members = (data as any[]) || [];
        const userIds = members.map((m) => m.user_id).filter(Boolean);
        if (userIds.length === 0) return [];

        const authUsers = await this.authUsers.listUsers({ ids: userIds });
        const authById = new Map(authUsers.map((u) => [u.id, u]));

        // Peran yang OTORITATIF ada di tabel `users` milik acca-app, sebagai
        // string bergabung koma ("GURU,ADMIN"). Keanggotaan CBT hanya cadangan:
        // ia sering berisi "Siswa" secara bawaan, dan memakainya lebih dulu akan
        // melabeli seorang guru sebagai siswa.
        const { data: appUsers } = await this.db
            .from('users')
            .select('auth_id, role')
            .in('auth_id', userIds);

        const appRoleById = new Map(
            ((appUsers as Array<{ auth_id: string | null; role: string | null }>) || [])
                .filter((u) => u.auth_id)
                .map((u) => [u.auth_id as string, u.role || '']),
        );

        return members
            .map((member) => {
                const account = authById.get(member.user_id);
                const membershipRoles = (member.member_roles || [])
                    .map((mr: any) => mr?.roles?.name)
                    .filter(Boolean) as string[];

                return {
                    id: member.id,
                    userId: member.user_id,
                    isActive: member.is_active,
                    lastLoginAt: account?.last_sign_in_at ?? null,
                    fullName: member.profiles?.full_name || 'Tanpa nama',
                    avatarUrl: member.profiles?.avatar_url ?? null,
                    role: this.labelRole(
                        appRoleById.get(member.user_id) || '',
                        membershipRoles,
                    ),
                };
            })
            .sort((a, b) => {
                const ta = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
                const tb = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
                return tb - ta;
            })
            .slice(0, limit);
    }

    /**
     * Label peran tertinggi yang dikenal.
     *
     * Peran di luar daftar baku (mis. WAKA, TAMU) ditampilkan APA ADANYA, bukan
     * dijatuhkan ke "Siswa": memberi label yang salah pada staf sekolah lebih
     * membingungkan daripada menampilkan sebutan yang tidak dikenal.
     */
    private labelRole(appRole: string, membershipRoles: string[]): string {
        const tokens = appRole
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);

        const raw = tokens.length > 0 ? tokens : membershipRoles.filter(Boolean);
        const upper = new Set(raw.map((t) => t.toUpperCase()));

        for (const role of ROLE_PRIORITY) {
            if (upper.has(role)) return ROLE_LABEL[role];
        }
        return raw[0] || 'Pengguna';
    }

    // ── Tahun ajaran ─────────────────────────────────────────────────────────

    async listSchoolYears(user: AuthUser, organizationId: string) {
        await this.authz.assertOrgStaff(user, organizationId);

        const { data, error } = await this.db
            .from('school_years')
            .select('*')
            .eq('organization_id', organizationId)
            .order('year', { ascending: false });

        if (error) {
            this.logger.error(`Gagal membaca tahun ajaran: ${error.message}`);
            return [];
        }
        return (data as any[]) || [];
    }

    async getActiveSchoolYear(user: AuthUser, organizationId: string) {
        await this.authz.assertOrgStaff(user, organizationId);

        const { data } = await this.db
            .from('school_years')
            .select('*')
            .eq('organization_id', organizationId)
            .eq('is_active', true)
            .maybeSingle();

        if (data) return data;

        // Fallback ke master_tahun_ajaran (master data acca-app)
        const { data: masterYear } = await this.db
            .from('master_tahun_ajaran')
            .select('tahun_ajaran')
            .eq('is_active', true)
            .order('tahun_ajaran', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (masterYear) {
            return {
                id: null,
                organization_id: organizationId,
                year: (masterYear as { tahun_ajaran: string }).tahun_ajaran,
                is_active: true,
            };
        }

        return null;
    }

    async createSchoolYear(
        user: AuthUser,
        organizationId: string,
        input: { year: string; startDate?: string; endDate?: string },
    ) {
        await this.authz.assertProktor(user, organizationId);

        const year = input.year.trim();
        if (!SCHOOL_YEAR_PATTERN.test(year)) {
            throw new BadRequestException(
                'Format tahun ajaran harus YYYY/YYYY, contoh: 2025/2026.',
            );
        }

        const { data, error } = await this.db
            .from('school_years')
            .insert({
                organization_id: organizationId,
                year,
                start_date: input.startDate || null,
                end_date: input.endDate || null,
                is_active: false,
            })
            .select()
            .single();

        if (error) {
            throw new BadRequestException(
                error.code === UNIQUE_VIOLATION
                    ? 'Tahun ajaran itu sudah ada.'
                    : error.message,
            );
        }

        return { id: (data as { id: string }).id, data };
    }

    /**
     * Tahun ajaran yang terdaftar di kelas organisasi ini.
     *
     * Berbeda dari `listSchoolYears`, yang membaca tabel `school_years`: di sini
     * yang dikembalikan adalah tahun yang BENAR-BENAR dipakai kelas, untuk
     * penyaring daftar kelas.
     */
    async listClassSchoolYears(user: AuthUser, organizationId: string): Promise<string[]> {
        await this.authz.assertOrgStaff(user, organizationId);

        const { data, error } = await this.db
            .from('cbt_classes')
            .select('school_year')
            .eq('organization_id', organizationId)
            .not('school_year', 'is', null)
            .order('school_year', { ascending: false });

        if (error) return [];

        return [
            ...new Set(
                ((data as Array<{ school_year: string | null }>) || [])
                    .map((c) => c.school_year)
                    .filter((y): y is string => Boolean(y)),
            ),
        ];
    }

    /**
     * Mata pelajaran dari master data acca-app.
     *
     * Sama persis dengan `PasService.listSubjects` — keduanya membaca
     * `master_mapel`. Tetap ada di dua tempat karena halaman yang memanggilnya
     * berbeda; bila suatu saat salah satunya berubah, yang berubah harus
     * keduanya.
     */
    async listSubjects(user: AuthUser, organizationId: string) {
        await this.authz.assertOrgStaff(user, organizationId);

        const { data, error } = await this.db
            .from('master_mapel')
            .select('id, kode, name:nama, kelompok, aktif')
            .eq('aktif', true)
            .order('nama', { ascending: true });

        if (error) {
            this.logger.error(`Gagal membaca master mapel: ${error.message}`);
            return [];
        }
        return (data as any[]) || [];
    }
}
