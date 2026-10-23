import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const isPayloadTooLarge =
      typeof exception === 'object' &&
      exception !== null &&
      'type' in exception &&
      exception.type === 'entity.too.large';

    const status =
      isPayloadTooLarge
        ? HttpStatus.PAYLOAD_TOO_LARGE
        : exception instanceof HttpException
          ? exception.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR;

    const raw =
      exception instanceof HttpException
        ? exception.getResponse()
        : (exception as Error)?.message || 'Internal Server Error';

    const detail =
      typeof raw === 'object' && raw !== null
        ? (raw as { message?: unknown }).message || raw
        : raw;

    // Log internal tetap memuat pesan asli lengkap — itu yang dibutuhkan saat
    // menelusuri masalah.
    this.logger.error(
      `[${request.method}] ${request.url} — ${status} — ${JSON.stringify(detail)}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    // Yang dikirim keluar hanya pesan dari HttpException yang memang ditulis
    // untuk pengguna. Galat tak terduga (mis. Prisma) dibalas pesan umum:
    // aslinya memuat path absolut server dan cuplikan SQL.
    const safe = isPayloadTooLarge
      ? 'Ukuran data terlalu besar. Batas maksimum request adalah 10 MB.'
      : exception instanceof HttpException
        ? sanitizeDatabaseDetail(detail)
        : 'Terjadi kesalahan pada server. Silakan coba lagi.';

    response.status(status).json({
      ok: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      error: safe,
    });
  }
}

/**
 * Banyak service meneruskan `error.message` dari adapter database ke
 * BadRequestException. Pesan itu memuat cuplikan SQL dan nama kolom
 * (mis. "Invalid `prisma.$queryRawUnsafe()` invocation ... column ... does not
 * exist"), jadi tidak boleh sampai ke layar pengguna. Kolom/tabel yang belum
 * ada berarti migrasi belum diterapkan; pesannya menyebut itu.
 */
export function sanitizeDatabaseDetail(detail: unknown): unknown {
  if (typeof detail !== 'string') return detail;
  const leaked = /prisma\.|\$queryRaw|\$executeRaw|Raw query failed|Code: `[0-9A-Z]{5}`|violates .* constraint|duplicate key value|syntax error at or near|relation "[^"]+" does not exist|column "[^"]+" (of relation "[^"]+" )?does not exist/i;
  if (!leaked.test(detail)) return detail;
  if (/Code: `(42703|42P01)`|(column|relation) "[^"]+" (of relation "[^"]+" )?does not exist/i.test(detail)) {
    return 'Struktur database belum diperbarui untuk fitur ini. Minta admin menjalankan migrasi database terbaru, lalu coba lagi.';
  }
  return 'Permintaan belum dapat diproses oleh database. Periksa isian lalu coba lagi.';
}
