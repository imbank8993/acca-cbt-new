import {
    CanActivate,
    ExecutionContext,
    HttpException,
    HttpStatus,
    Injectable,
    SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * Pembatas laju in-memory (jendela tetap).
 *
 * API berjalan sebagai SATU proses (ecosystem.config.js: instances: 1), jadi
 * penghitung di memori sudah cukup dan tidak menambah dependensi. Bila kelak
 * dijalankan lebih dari satu instance, batas efektifnya menjadi N kali lipat;
 * saat itu pindahkan penyimpanan penghitung ke Redis/Postgres.
 */
export class RateLimiter {
    private readonly buckets = new Map<string, { count: number; resetAt: number }>();

    constructor(private readonly now: () => number = Date.now) {}

    /** Catat satu kejadian. Mengembalikan detik tunggu bila batas terlampaui, atau 0. */
    hit(key: string, limit: number, windowMs: number): number {
        const now = this.now();
        this.sweep(now);
        let bucket = this.buckets.get(key);
        if (!bucket || bucket.resetAt <= now) {
            bucket = { count: 0, resetAt: now + windowMs };
            this.buckets.set(key, bucket);
        }
        bucket.count += 1;
        return bucket.count > limit ? Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) : 0;
    }

    /** Detik tunggu bila kunci sudah melewati batas, tanpa menambah hitungan. */
    blocked(key: string, limit: number): number {
        const now = this.now();
        const bucket = this.buckets.get(key);
        if (!bucket || bucket.resetAt <= now || bucket.count < limit) return 0;
        return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    }

    reset(key: string): void {
        this.buckets.delete(key);
    }

    private sweep(now: number): void {
        if (this.buckets.size < 20_000) return;
        for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
    }
}

export function tooManyRequests(retryAfterSeconds: number, message?: string): HttpException {
    return new HttpException({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'RATE_LIMITED',
        retryAfterSeconds,
        message: message || `Terlalu banyak permintaan. Coba lagi dalam ${retryAfterSeconds} detik.`,
    }, HttpStatus.TOO_MANY_REQUESTS);
}

export interface RateLimitOptions {
    /** Nama kelompok; endpoint dengan nama sama berbagi kuota. */
    name: string;
    limit: number;
    windowMs: number;
}

export const RATE_LIMIT_KEY = 'cbt:rate-limit';
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

/** Satu penghitung bersama untuk seluruh endpoint yang memakai guard ini. */
export const sharedRateLimiter = new RateLimiter();

/**
 * Dipasang SETELAH JwtAuthGuard, sehingga kuota dihitung per akun. Permintaan
 * tanpa akun (endpoint publik) dihitung per alamat IP.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (!options) return true;
        const request = context.switchToHttp().getRequest();
        // Panggilan antar-layanan (impor bank soal, persamaan) bukan pengguna.
        const internalKey = process.env.INTERNAL_API_KEY;
        if (!request.user && internalKey && request.headers?.['x-internal-key'] === internalKey) return true;
        const subject = request.user?.id ? `user:${request.user.id}` : `ip:${request.ip || 'unknown'}`;
        const wait = sharedRateLimiter.hit(`${options.name}:${subject}`, options.limit, options.windowMs);
        if (wait) throw tooManyRequests(wait);
        return true;
    }
}
