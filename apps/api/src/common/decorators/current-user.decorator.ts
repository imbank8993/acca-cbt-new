import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Identitas pemanggil hasil verifikasi `JwtStrategy`.
 *
 * Inilah satu-satunya sumber identitas yang boleh dipercaya. Server action lama
 * menerima `userId` sebagai parameter dari browser di 62 tempat — nilai itu
 * tetap diterima demi kompatibilitas signature, tetapi TIDAK boleh dipakai
 * untuk otorisasi.
 */
export const CurrentUser = createParamDecorator(
  (field: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    if (!request.user) return null;
    return field ? request.user[field] : request.user;
  },
);
