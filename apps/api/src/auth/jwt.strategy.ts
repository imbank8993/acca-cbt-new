import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthUser } from '@acca-cbt/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthContextCache, type CachedIdentity } from './auth-context-cache';
import { AuthUsersRepository, sessionVersionOf } from './auth-users.repository';
import { CbtRolesService } from './cbt-roles.service';

interface JwtPayload {
  sub?: string;
  /** UUID `auth.users.id` — dipakai token terbitan acca-new. */
  authId?: string;
  email?: string;
  username?: string;
  role?: string;
  /** Versi sesi akun saat token diterbitkan (acca-new dan CBT). */
  sessionVersion?: string;
  iat?: number;
}

/**
 * Token tanpa klaim `sessionVersion` hanya diterbitkan CBT versi lama (umur 12
 * jam). Diterima selama masa itu agar rilis ini tidak mengeluarkan siswa yang
 * sedang ujian; setelahnya klaim wajib ada.
 */
export const LEGACY_TOKEN_MAX_AGE_SECONDS = 12 * 60 * 60;

/**
 * Apakah token masih sah terhadap versi sesi akun.
 *
 * Dulu CBT menerima token acca-new (JWT_SECRET sama) tanpa memeriksa versi
 * sesi, sehingga logout semua sesi atau ganti password di acca-new tidak
 * mencabut akses token lama ke CBT hingga kedaluwarsa (7 hari).
 */
export function sessionVersionAccepted(
  payload: Pick<JwtPayload, 'sessionVersion' | 'iat'>,
  current: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (typeof payload.sessionVersion === 'string') return payload.sessionVersion === current;
  if (typeof payload.iat !== 'number') return false;
  return nowSeconds - payload.iat <= LEGACY_TOKEN_MAX_AGE_SECONDS;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verifikasi token bearer.
 *
 * Kunci rancangannya: `JWT_SECRET` disamakan dengan acca-new, sehingga token
 * yang diterbitkan acca-new langsung sah di sini. Bentuk payload keduanya
 * berbeda — acca-new memakai `sub` = `public_users.id` (bigint) dan menaruh UUID
 * di `authId`, sementara CBT memakai UUID di `sub` — jadi keduanya dikenali.
 *
 * Peran TIDAK diambil dari klaim token melainkan dibaca dari database. Token
 * yang dirakit sendiri karena itu tidak bisa menaikkan hak akses. Hasil baca itu
 * disimpan singkat di `AuthContextCache` (bawaan 30 detik) — tanpanya setiap
 * heartbeat, autosave, dan gambar soal menjalankan 7–11 query yang sama.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly authUsers: AuthUsersRepository,
    private readonly roles: CbtRolesService,
    private readonly cache: AuthContextCache,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET belum diset — lihat apps/api/.env.example.');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    const authId = await this.resolveAuthId(payload);
    if (!authId) {
      throw new UnauthorizedException('Payload token tidak valid.');
    }

    const load = () => this.loadUser(authId, payload.email);
    let identity = await this.cache.identity(authId, load);
    if (!sessionVersionAccepted(payload, identity.sessionVersion)) {
      // Salinan tersimpan bisa lebih tua dari token (mis. baru login ulang
      // setelah logout semua sesi). Baca ulang sekali sebelum menolak.
      this.cache.invalidate(authId);
      identity = await this.cache.identity(authId, load);
      if (!sessionVersionAccepted(payload, identity.sessionVersion)) {
        throw new UnauthorizedException('Sesi telah berakhir. Silakan login kembali.');
      }
    }
    return identity.user;
  }

  /** Baca identitas lengkap dari database; dilempar bila tidak sah (tidak disimpan). */
  private async loadUser(authId: string, payloadEmail?: string): Promise<CachedIdentity> {
    const user = await this.authUsers.findById(authId);
    if (!user) {
      throw new UnauthorizedException('Pengguna tidak ditemukan atau sesi telah berakhir.');
    }
    if (user.banned_until && new Date(user.banned_until) > new Date()) {
      throw new UnauthorizedException('Akun sedang dinonaktifkan.');
    }

    const email = (user.email || payloadEmail || '').toLowerCase();

    // ─── Periksa status aktif di master tabel public.users ──────────────────────
    const publicUsers = await this.prisma.$queryRawUnsafe<
      Array<{ id: bigint; aktif: boolean; nama: string | null; nama_lengkap: string | null }>
    >(
      `SELECT id, aktif, nama, nama_lengkap 
         FROM public.users 
        WHERE auth_id = $1::uuid
        LIMIT 1`,
      user.id,
    );

    if (publicUsers.length > 0 && publicUsers[0].aktif === false) {
      throw new UnauthorizedException('Akun Anda telah dinonaktifkan di sistem ACCA.');
    }

    const context = await this.roles.resolve(user.id, email, user.raw_user_meta_data);

    const verifiedName =
      publicUsers[0]?.nama_lengkap ||
      publicUsers[0]?.nama ||
      (user.raw_user_meta_data?.full_name as string) ||
      null;

    return {
      sessionVersion: sessionVersionOf(user.raw_app_meta_data),
      user: {
        id: user.id,
        email,
        fullName: verifiedName,
        roles: context.roleNames,
        resolved: context.resolved,
        bestRole: context.bestRole,
        organizationId: context.organizationId,
        organizationName: context.organizationName,
        isPlatformAdmin: context.isPlatformAdmin,
      },
    };
  }

  /** Cari UUID `auth.users` dari bentuk payload mana pun yang datang. */
  private async resolveAuthId(payload: JwtPayload): Promise<string | null> {
    if (payload.authId && UUID_PATTERN.test(payload.authId)) return payload.authId;
    if (payload.sub && UUID_PATTERN.test(payload.sub)) return payload.sub;

    // Token acca-new: `sub` adalah public_users.id (bigint).
    // Ambil auth_id yang valid dari public.users untuk menjamin identitas pengguna
    // tidak pernah tertukar antar akun.
    if (payload.sub && /^\d+$/.test(payload.sub)) {
      const legacyId = payload.sub;
      const authId = await this.cache.legacyIds.get(legacyId, async () => {
        const rows = await this.prisma.$queryRawUnsafe<Array<{ auth_id: string | null }>>(
          `SELECT auth_id FROM public.users WHERE id = $1::bigint LIMIT 1`,
          legacyId,
        );
        return rows[0]?.auth_id || null;
      });
      if (authId) return authId;
    }

    if (payload.email) {
      const user = await this.authUsers.findByEmail(payload.email);
      if (user) return user.id;
    }

    return null;
  }
}
