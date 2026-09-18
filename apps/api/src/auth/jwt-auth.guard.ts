import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ALLOW_INTERNAL_KEY } from './allow-internal-key.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Kunci internal hanya berlaku pada endpoint yang MENYEBUTNYA lewat
    // @AllowInternalKey(). Sebelumnya ia diterima di endpoint mana pun, sehingga
    // seluruh endpoint terjaga bisa dipanggil tanpa pengguna — dan
    // @CurrentUser() diam-diam menjadi null.
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_INTERNAL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (allowed) {
      const request = context.switchToHttp().getRequest();
      const expected = process.env.INTERNAL_API_KEY;
      if (expected && request.headers['x-internal-key'] === expected) {
        return true;
      }
    }

    return super.canActivate(context);
  }

  handleRequest<TUser>(err: unknown, user: TUser): TUser {
    if (err || !user) {
      throw (
        err ||
        new UnauthorizedException('Akses ditolak. Token tidak valid atau tidak ditemukan.')
      );
    }
    return user;
  }
}
