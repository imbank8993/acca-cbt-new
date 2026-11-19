import {
    CanActivate,
    ExecutionContext,
    HttpException,
    HttpStatus,
    Injectable,
    SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { cluster } from './node-cluster';

/**
 * Pembatas laju in-memory (jendela tetap) untuk satu proses.
 *
 * Endpoint memakai `SharedRateLimiter` di bawah: dalam mode cluster
 * (API_WORKERS > 1) penghitungnya dipegang proses induk, sehingga batas tetap
 * berlaku untuk seluruh proses dan tidak menjadi N kali lipat.
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

type LimiterOp = 'hit' | 'blocked' | 'reset';
interface LimiterRequest {
    cbtRateLimit: true; id: number; limiter: string; op: LimiterOp; key: string; limit: number; windowMs: number;
}
interface LimiterReply { cbtRateLimitReply: true; id: number; wait: number }

/** Proses induk biasanya menjawab dalam < 1 ms; ini hanya jaring pengaman. */
const CLUSTER_LIMIT_TIMEOUT_MS = 1_000;

function applyOp(limiter: RateLimiter, op: LimiterOp, key: string, limit: number, windowMs: number): number {
    if (op === 'hit') return limiter.hit(key, limit, windowMs);
    if (op === 'blocked') return limiter.blocked(key, limit);
    limiter.reset(key);
    return 0;
}

let nextRequestId = 1;
const pendingReplies = new Map<number, (wait: number) => void>();
let replyListenerInstalled = false;

function askPrimary(request: Omit<LimiterRequest, 'cbtRateLimit' | 'id'>): Promise<number> {
    if (!replyListenerInstalled) {
        replyListenerInstalled = true;
        process.on('message', (message: unknown) => {
            const reply = message as Partial<LimiterReply> | null;
            if (!reply || reply.cbtRateLimitReply !== true || typeof reply.id !== 'number') return;
            pendingReplies.get(reply.id)?.(Number(reply.wait) || 0);
        });
    }
    return new Promise<number>((resolve, reject) => {
        const id = nextRequestId++;
        const timer = setTimeout(() => {
            pendingReplies.delete(id);
            reject(new Error('Proses induk tidak menjawab.'));
        }, CLUSTER_LIMIT_TIMEOUT_MS);
        pendingReplies.set(id, wait => {
            clearTimeout(timer);
            pendingReplies.delete(id);
            resolve(wait);
        });
        process.send!({ cbtRateLimit: true, id, ...request } satisfies LimiterRequest, undefined, {}, error => {
            if (!error) return;
            clearTimeout(timer);
            pendingReplies.delete(id);
            reject(error);
        });
    });
}

/**
 * Pembatas laju yang berlaku untuk seluruh proses API.
 *
 * Tanpa cluster, ia langsung memakai penghitung lokal (operasinya selesai
 * sinkron sebelum Promise dikembalikan). Di proses anak cluster, setiap operasi
 * ditanyakan ke proses induk; bila induk tidak menjawab, penghitung lokal dipakai
 * supaya permintaan siswa tidak pernah tertahan karena pembatas laju.
 */
export class SharedRateLimiter {
    private readonly local: RateLimiter;

    constructor(private readonly name: string, now?: () => number) {
        this.local = new RateLimiter(now);
    }

    hit(key: string, limit: number, windowMs: number): Promise<number> {
        return this.call('hit', key, limit, windowMs);
    }

    blocked(key: string, limit: number): Promise<number> {
        return this.call('blocked', key, limit, 0);
    }

    async reset(key: string): Promise<void> {
        await this.call('reset', key, 0, 0);
    }

    private call(op: LimiterOp, key: string, limit: number, windowMs: number): Promise<number> {
        if (!cluster.isWorker || typeof process.send !== 'function') {
            return Promise.resolve(applyOp(this.local, op, key, limit, windowMs));
        }
        return askPrimary({ limiter: this.name, op, key, limit, windowMs })
            .catch(() => applyOp(this.local, op, key, limit, windowMs));
    }
}

/** Dipanggil di proses induk cluster: memegang semua penghitung batas laju. */
export function serveClusterRateLimits(): void {
    const limiters = new Map<string, RateLimiter>();
    cluster.on('message', (worker, message: unknown) => {
        const request = message as Partial<LimiterRequest> | null;
        if (!request || request.cbtRateLimit !== true || typeof request.id !== 'number' ||
            typeof request.limiter !== 'string' || typeof request.key !== 'string') return;
        let limiter = limiters.get(request.limiter);
        if (!limiter) limiters.set(request.limiter, limiter = new RateLimiter());
        const op = request.op === 'hit' || request.op === 'blocked' || request.op === 'reset' ? request.op : 'blocked';
        const wait = applyOp(limiter, op, request.key, Number(request.limit) || 0, Number(request.windowMs) || 0);
        if (worker.isConnected()) worker.send({ cbtRateLimitReply: true, id: request.id, wait } satisfies LimiterReply);
    });
}

export const RATE_LIMIT_KEY = 'cbt:rate-limit';
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

/** Satu penghitung bersama untuk seluruh endpoint yang memakai guard ini. */
export const sharedRateLimiter = new SharedRateLimiter('endpoints');

/**
 * Dipasang SETELAH JwtAuthGuard, sehingga kuota dihitung per akun. Permintaan
 * tanpa akun (endpoint publik) dihitung per alamat IP.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
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
        const wait = await sharedRateLimiter.hit(`${options.name}:${subject}`, options.limit, options.windowMs);
        if (wait) throw tooManyRequests(wait);
        return true;
    }
}
