import { CallHandler, ExecutionContext, GoneException, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { from, Observable, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { DbService } from '../../prisma/prisma-db-adapter';
import { EXAM_CANCELLED_CODE, EXAM_CANCELLED_MESSAGE, isCancelledAttempt } from '../exam-cancellation';

/** Status yang dipakai jalur siswa ketika attempt-nya tidak ada / tidak berlaku. */
const TRANSLATED = new Set([400, 403, 404, 409]);

/**
 * Pengerjaan yang dihapus oleh pembatalan ujian membuat setiap permintaan siswa
 * (simpan jawaban, heartbeat, kumpul, antrean offline) gagal dengan pesan
 * "tidak ditemukan/tidak diizinkan" yang membingungkan. Interseptor ini hanya
 * bekerja di jalur galat: bila attempt-nya ada di arsip pembatalan milik
 * pengguna ini, galatnya diganti 410 EXAM_CANCELLED agar perangkat siswa keluar
 * dari ujian dan membersihkan salinan lokalnya.
 */
@Injectable()
export class CancelledAttemptInterceptor implements NestInterceptor {
    constructor(private readonly db: DbService) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        return next.handle().pipe(
            catchError(error => from(this.translate(context, error)).pipe(mergeMap(translated => throwError(() => translated)))),
        );
    }

    private async translate(context: ExecutionContext, error: unknown): Promise<unknown> {
        if (!(error instanceof HttpException) || !TRANSLATED.has(error.getStatus())) return error;
        const request = context.switchToHttp().getRequest<{
            user?: { id?: string }; params?: Record<string, string>; body?: Record<string, unknown>;
        }>();
        const userId = request.user?.id;
        const attemptId = request.params?.attemptId ?? request.body?.attemptId;
        if (typeof userId !== 'string' || typeof attemptId !== 'string' || !isUUID(attemptId)) return error;
        const cancelled = await isCancelledAttempt(this.db, attemptId, userId).catch(() => false);
        return cancelled ? new GoneException({ code: EXAM_CANCELLED_CODE, message: EXAM_CANCELLED_MESSAGE }) : error;
    }
}
