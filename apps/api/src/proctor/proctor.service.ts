import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';
import { AuthUsersRepository } from '../auth/auth-users.repository';
import { AuthorizationService } from '../auth/authorization.service';
import { listOperationalSubjects } from '../common/subject-catalog';
import { insertIdempotently } from '../common/idempotent-create';
import { DbService } from '../prisma/prisma-db-adapter';
import { PrismaService } from '../prisma/prisma.service';

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
        private readonly prisma: PrismaService,
    ) {}

    /**
     * Peraih nilai tertinggi per ujian, untuk ringkasan dasbor.
     *
     * Satu query dengan ROW_NUMBER() supaya tidak menarik seluruh pengerjaan ke
     * memori. Hanya pengerjaan yang SUDAH dikumpulkan dan SUDAH bernilai yang
     * dihitung — esai yang menunggu koreksi (total_score null) dilewati agar
     * peringkat tidak menyesatkan. Nilai sama diurutkan menurut siapa yang
     * lebih dulu mengumpulkan. Ujian yang diarsipkan tidak ditampilkan.
     */
    async getTopScorers(
        user: AuthUser,
        organizationId: string,
        opts: { examLimit: number; perExam: number },
    ) {
        await this.authz.assertOrgMonitoring(user, organizationId);

        const rows = await this.prisma.$queryRawUnsafe<
            Array<{
                exam_id: string;
                exam_title: string;
                exam_type: string | null;
                last_finished_at: Date | null;
                participant_count: number;
                rank: number;
                user_id: string;
                full_name: string | null;
                identity_number: string | null;
                total_score: string | number;
                finished_at: Date | null;
            }>
        >(
            `WITH scored AS (
                SELECT a.exam_id, a.user_id, a.total_score, a.finished_at,
                       ROW_NUMBER() OVER (
                           PARTITION BY a.exam_id
                           ORDER BY a.total_score DESC, a.finished_at ASC NULLS LAST
                       ) AS rank,
                       COUNT(*) OVER (PARTITION BY a.exam_id)::int AS participant_count,
                       MAX(a.finished_at) OVER (PARTITION BY a.exam_id) AS last_finished_at
                  FROM public.cbt_exam_attempts a
                  JOIN public.cbt_exams e ON e.id = a.exam_id
                 WHERE e.organization_id = $1::uuid
                   AND COALESCE(e.metadata->>'archived_at', '') = ''
                   AND COALESCE(e.exam_type, '') <> 'assignment'
                   AND a.status IN ('submitted', 'auto_submitted')
                   AND a.total_score IS NOT NULL
             ),
             recent_exams AS (
                SELECT exam_id
                  FROM scored
                 GROUP BY exam_id
                 ORDER BY MAX(last_finished_at) DESC NULLS LAST
                 LIMIT $2
             )
             SELECT s.exam_id, e.title AS exam_title, e.exam_type,
                    s.last_finished_at, s.participant_count, s.rank::int AS rank,
                    s.user_id, p.full_name, p.identity_number,
                    s.total_score, s.finished_at
               FROM scored s
               JOIN recent_exams r ON r.exam_id = s.exam_id
               JOIN public.cbt_exams e ON e.id = s.exam_id
               LEFT JOIN public.cbt_profiles p ON p.id = s.user_id
              WHERE s.rank <= $3
              ORDER BY s.last_finished_at DESC NULLS LAST, s.exam_id, s.rank`,
            organizationId,
            opts.examLimit,
            opts.perExam,
        );

        const iso = (d: Date | null) => (d instanceof Date ? d.toISOString() : d ? String(d) : null);
        const byExam = new Map<string, {
            examId: string;
            title: string;
            examType: string | null;
            participantCount: number;
            lastFinishedAt: string | null;
            topScorers: Array<{
                rank: number;
                userId: string;
                fullName: string;
                identityNumber: string | null;
                score: number;
                finishedAt: string | null;
            }>;
        }>();

        for (const r of rows) {
            let exam = byExam.get(r.exam_id);
            if (!exam) {
                exam = {
                    examId: r.exam_id,
                    title: r.exam_title,
                    examType: r.exam_type,
                    participantCount: Number(r.participant_count) || 0,
                    lastFinishedAt: iso(r.last_finished_at),
                    topScorers: [],
                };
                byExam.set(r.exam_id, exam);
            }
            exam.topScorers.push({
                rank: Number(r.rank),
                userId: r.user_id,
                fullName: r.full_name || 'Tanpa nama',
                identityNumber: r.identity_number,
                score: Math.round(Number(r.total_score) * 100) / 100,
                finishedAt: iso(r.finished_at),
            });
        }

        return [...byExam.values()];
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
            draftExams: rows.filter((e) => !e.is_published && e.status !== 'active').length,
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
        input: { year: string; startDate?: string; endDate?: string; clientRequestId: string },
    ) {
        await this.authz.assertProktor(user, organizationId);

        const year = input.year.trim();
        if (!SCHOOL_YEAR_PATTERN.test(year)) {
            throw new BadRequestException(
                'Format tahun ajaran harus YYYY/YYYY, contoh: 2025/2026.',
            );
        }

        const data = await insertIdempotently<any>(this.db, {
            table: 'school_years',
            organizationId,
            clientRequestId: input.clientRequestId,
            fingerprint: input,
            payload: {
                organization_id: organizationId,
                year,
                start_date: input.startDate || null,
                end_date: input.endDate || null,
                is_active: false,
            },
            mapError: (error) => new BadRequestException(
                error.code === UNIQUE_VIOLATION
                    ? 'Tahun ajaran itu sudah ada.'
                    : error.message,
            ),
        });

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

    /** Master data diselaraskan ke UUID operasional yang dipakai foreign key CBT. */
    async listSubjects(user: AuthUser, organizationId: string) {
        await this.authz.assertOrgStaff(user, organizationId);
        return listOperationalSubjects(this.db, organizationId);
    }
}
