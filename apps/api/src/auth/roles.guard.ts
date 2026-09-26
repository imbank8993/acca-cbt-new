import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '@acca-cbt/shared';
import { ROLES_KEY } from './roles.decorator';

/**
 * Penegak `@Roles()`. Selalu dipasang SETELAH `JwtAuthGuard` supaya `req.user`
 * sudah terisi.
 *
 * Peran dibaca dari `req.user.roles`, yang diisi `JwtStrategy` dari database —
 * bukan dari klaim token — jadi tidak bisa dipalsukan lewat token rakitan.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUser | undefined;

    // Panggilan dengan kunci internal tidak membawa pengguna, sehingga tidak
    // dapat membuktikan peran apa pun. Sebelumnya kunci itu MELEWATI pemeriksaan
    // ini sepenuhnya — artinya siapa pun yang memegangnya memperoleh hak setara
    // Admin pada setiap endpoint ber-@Roles. Endpoint yang memang perlu
    // dipanggil antar-service tidak boleh memakai @Roles.
    if (!user) {
      throw new ForbiddenException(
        'Endpoint ini memerlukan identitas pengguna, bukan kunci antar-service.',
      );
    }

    // Superadmin dan admin platform melewati daftar peran biasa. Pembatasan ke
    // satu sekolah tetap dilakukan oleh AuthorizationService pada endpointnya.
    if (user.resolved?.superadmin || user.isPlatformAdmin) return true;

    const held = new Set((user.roles || []).map((r) => r.toUpperCase()));
    const wanted = required.map((r) => r.toUpperCase());

    if (!wanted.some((r) => held.has(r))) {
      throw new ForbiddenException(
        'Akses ditolak. Anda tidak memiliki peran yang diperlukan untuk tindakan ini.',
      );
    }
    return true;
  }
}
