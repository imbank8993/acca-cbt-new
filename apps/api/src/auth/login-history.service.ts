import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface LoginHistoryRecord {
    id: string;
    userId: string;
    fullName: string;
    avatarUrl: string | null;
    role: string | null;
    loginMethod: string;
    ipAddress: string | null;
    userAgent: string | null;
    deviceType: string | null;
    browser: string | null;
    os: string | null;
    success: boolean;
    failureReason: string | null;
    createdAt: string;
}

export interface LoginStats {
    todayTotal: number;
    todayUnique: number;
    weekTotal: number;
    todayFailed: number;
}

@Injectable()
export class LoginHistoryService {
    private readonly logger = new Logger(LoginHistoryService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Catat satu kejadian login ke riwayat.
     */
    async record(input: {
        userId: string;
        loginMethod: 'password' | 'sso';
        ipAddress?: string | null;
        userAgent?: string | null;
        success: boolean;
        failureReason?: string | null;
    }): Promise<void> {
        const userAgent = (input.userAgent || '').slice(0, 1024);
        const ipAddress = this.normalizeIp(input.ipAddress);
        const parsed = this.parseUserAgent(userAgent);

        try {
            await this.prisma.$executeRawUnsafe(
                `INSERT INTO public.cbt_login_history
                    (user_id, login_method, ip_address, user_agent, device_type, browser, os, success, failure_reason)
                 VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)`,
                input.userId,
                input.loginMethod,
                ipAddress,
                userAgent || null,
                parsed.deviceType,
                parsed.browser,
                parsed.os,
                input.success,
                input.failureReason || null,
            );
        } catch (error) {
            // Pencatatan riwayat tidak boleh menggagalkan login
            this.logger.error(`Gagal mencatat riwayat login: ${(error as Error).message}`);
        }
    }

    /**
     * Riwayat login terbaru seluruh anggota satu organisasi.
     */
    async getRecent(organizationId: string, limit: number, offset = 0): Promise<LoginHistoryRecord[]> {
        const rows = await this.prisma.$queryRawUnsafe<
            Array<{
                id: string;
                user_id: string;
                full_name: string | null;
                avatar_url: string | null;
                app_role: string | null;
                login_method: string;
                ip_address: string | null;
                user_agent: string | null;
                device_type: string | null;
                browser: string | null;
                os: string | null;
                success: boolean;
                failure_reason: string | null;
                created_at: Date;
            }>
        >(
            `SELECT
                h.id,
                h.user_id,
                COALESCE(p.full_name, 'Tanpa nama') AS full_name,
                p.avatar_url,
                u.role AS app_role,
                h.login_method,
                h.ip_address,
                h.user_agent,
                h.device_type,
                h.browser,
                h.os,
                h.success,
                h.failure_reason,
                h.created_at
             FROM public.cbt_login_history h
             JOIN public.cbt_organization_members m
               ON m.user_id = h.user_id AND m.organization_id = $1::uuid
             LEFT JOIN public.cbt_profiles p ON p.id = h.user_id
             LEFT JOIN public.users u ON u.auth_id = h.user_id
             ORDER BY h.created_at DESC
             LIMIT $2 OFFSET $3`,
            organizationId,
            limit,
            offset,
        );

        return rows.map((r) => ({
            id: r.id,
            userId: r.user_id,
            fullName: r.full_name || 'Tanpa nama',
            avatarUrl: r.avatar_url,
            role: this.labelRole(r.app_role),
            loginMethod: r.login_method,
            ipAddress: r.ip_address,
            userAgent: r.user_agent,
            deviceType: r.device_type,
            browser: r.browser,
            os: r.os,
            success: r.success,
            failureReason: r.failure_reason,
            createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        }));
    }

    /**
     * Statistik login hari ini dan 7 hari terakhir. "Hari ini" dihitung sejak
     * tengah malam di zona waktu sekolah, bukan zona waktu sesi database.
     */
    async getStats(organizationId: string, timeZone = 'Asia/Jakarta'): Promise<LoginStats> {
        const rows = await this.prisma.$queryRawUnsafe<
            Array<{
                today_total: bigint;
                today_unique: bigint;
                week_total: bigint;
                today_failed: bigint;
            }>
        >(
            `WITH bounds AS (
                SELECT
                    (date_trunc('day', now() AT TIME ZONE $2::text) AT TIME ZONE $2::text) AS today_start,
                    (date_trunc('day', now() AT TIME ZONE $2::text) AT TIME ZONE $2::text) - INTERVAL '6 days' AS week_start
             )
             SELECT
                COUNT(*) FILTER (
                    WHERE h.created_at >= b.today_start AND h.success = true
                ) AS today_total,
                COUNT(DISTINCT h.user_id) FILTER (
                    WHERE h.created_at >= b.today_start AND h.success = true
                ) AS today_unique,
                COUNT(*) FILTER (WHERE h.success = true) AS week_total,
                COUNT(*) FILTER (
                    WHERE h.created_at >= b.today_start AND h.success = false
                ) AS today_failed
             FROM bounds b
             JOIN public.cbt_login_history h ON h.created_at >= b.week_start
             JOIN public.cbt_organization_members m
               ON m.user_id = h.user_id AND m.organization_id = $1::uuid`,
            organizationId,
            timeZone,
        );

        const r = rows[0];
        return {
            todayTotal: Number(r?.today_total ?? 0),
            todayUnique: Number(r?.today_unique ?? 0),
            weekTotal: Number(r?.week_total ?? 0),
            todayFailed: Number(r?.today_failed ?? 0),
        };
    }

    // ── Utilitas ──────────────────────────────────────────────────────────────

    private static readonly ROLE_LABEL: Record<string, string> = {
        SUPER_ADMIN: 'Admin',
        SUPERADMIN: 'Admin',
        ADMIN: 'Admin',
        PROKTOR: 'Proktor',
        GURU: 'Guru',
        PENGAWAS: 'Pengawas',
        SISWA: 'Siswa',
    };

    private labelRole(appRole: string | null): string {
        if (!appRole) return 'Pengguna';
        const tokens = appRole.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
        for (const token of tokens) {
            if (LoginHistoryService.ROLE_LABEL[token]) return LoginHistoryService.ROLE_LABEL[token];
        }
        return tokens[0] || 'Pengguna';
    }

    /**
     * Normalisasi IP: buang awalan IPv4-mapped (`::ffff:`), port, dan nilai
     * placeholder; potong sesuai lebar kolom (45).
     */
    private normalizeIp(raw?: string | null): string | null {
        let ip = (raw || '').split(',')[0].trim();
        if (!ip || ip.toLowerCase() === 'unknown') return null;
        if (ip.toLowerCase().startsWith('::ffff:')) ip = ip.slice(7);
        // "1.2.3.4:5678" → "1.2.3.4" (hanya untuk IPv4 berport)
        const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(ip);
        if (v4WithPort) ip = v4WithPort[1];
        if (ip === '::1') ip = '127.0.0.1';
        return ip.slice(0, 45);
    }

    /**
     * Urai user-agent sederhana tanpa pustaka luar.
     */
    private parseUserAgent(ua: string): {
        deviceType: string;
        browser: string;
        os: string;
    } {
        const lc = ua.toLowerCase();

        // Perangkat
        let deviceType = 'desktop';
        if (/mobile|android.*mobile|iphone|ipod/.test(lc)) deviceType = 'mobile';
        else if (/tablet|ipad|android(?!.*mobile)/.test(lc)) deviceType = 'tablet';

        // Browser — urutan penting: banyak UA turunan memuat "Chrome/" dan "Safari/".
        let browser = 'Lainnya';
        if (/edg(e|a|ios)?\//i.test(ua)) browser = 'Edge';
        else if (/opr\/|opera/i.test(ua)) browser = 'Opera';
        else if (/samsungbrowser\//i.test(ua)) browser = 'Samsung Internet';
        else if (/firefox\/|fxios\//i.test(ua)) browser = 'Firefox';
        else if (/chrome\/|crios\//i.test(ua)) browser = 'Chrome';
        else if (/safari\//i.test(ua)) browser = 'Safari';

        // OS — iOS harus dicek sebelum macOS karena UA iPhone memuat "like Mac OS X".
        let os = 'Lainnya';
        if (/windows/i.test(ua)) os = 'Windows';
        else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
        else if (/android/i.test(ua)) os = 'Android';
        else if (/\bcros\b/i.test(ua)) os = 'ChromeOS';
        else if (/macintosh|mac os/i.test(ua)) os = 'macOS';
        else if (/linux/i.test(ua)) os = 'Linux';

        return { deviceType, browser, os };
    }
}
