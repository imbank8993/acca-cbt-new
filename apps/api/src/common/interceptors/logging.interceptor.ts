import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Endpoint yang dipanggil berkala oleh setiap siswa/halaman selama ujian.
 * Ratusan siswa × heartbeat 15 detik, autosave, dan gambar soal menghasilkan
 * puluhan baris log per detik: CPU untuk menulis, dan log Docker yang membengkak.
 * Permintaan SUKSES ke jalur ini hanya dicatat bila lambat; galat tetap dicatat
 * oleh AllExceptionsFilter.
 */
const ROUTINE_PATHS: RegExp[] = [
  /^\/api\/proctoring\/attempts\/[^/]+\/(heartbeat|violations)$/,
  /^\/api\/students\/attempts\/[^/]+\/(answers(\/[^/]+)?|submission-status|late-answers)$/,
  /^\/api\/storage\/(file\/|school-logo$)/,
  /^\/api\/auth\/me$/,
  /^\/api\/notifications\/unread-count$/,
  /^\/api\/health$/,
];

export const DEFAULT_SLOW_REQUEST_MS = 1000;

export function slowRequestMs(raw: string | undefined = process.env.HTTP_LOG_SLOW_MS): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && raw !== undefined && raw.trim() !== ''
    ? parsed
    : DEFAULT_SLOW_REQUEST_MS;
}

/** Apakah permintaan sukses ini layak ditulis ke log. */
export function shouldLogRequest(
  url: string,
  durationMs: number,
  options: { logAll?: boolean; slowMs?: number } = {},
): boolean {
  if (options.logAll) return true;
  const path = (url || '').split('?')[0];
  if (!ROUTINE_PATHS.some(pattern => pattern.test(path))) return true;
  return durationMs >= (options.slowMs ?? DEFAULT_SLOW_REQUEST_MS);
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  /** HTTP_LOG_ALL=1 mengembalikan pencatatan setiap permintaan (untuk debug). */
  private readonly logAll = process.env.HTTP_LOG_ALL === '1';
  private readonly slowMs = slowRequestMs();

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const { method, url } = request;
    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startedAt;
        if (!shouldLogRequest(url, duration, { logAll: this.logAll, slowMs: this.slowMs })) return;
        const response = context.switchToHttp().getResponse();
        const message = `[${method}] ${url} ${response.statusCode} — ${duration}ms`;
        if (duration >= this.slowMs) this.logger.warn(`${message} (lambat)`);
        else this.logger.log(message);
      }),
    );
  }
}
