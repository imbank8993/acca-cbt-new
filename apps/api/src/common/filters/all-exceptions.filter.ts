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
        ? detail
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
