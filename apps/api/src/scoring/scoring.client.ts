import { HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Klien HTTP ke layanan FastAPI (apps/scoring).
 *
 * NestJS tetap pemilik tunggal akses database. FastAPI tidak pernah menyentuh
 * PostgreSQL: ia menerima data lewat payload, menghitung, dan mengembalikan
 * hasilnya. Dengan begitu hanya ada SATU tempat yang menegakkan otorisasi dan
 * kepemilikan data, dan layanan skoring bisa di-deploy ulang tanpa memikirkan
 * kredensial database.
 */
@Injectable()
export class ScoringClient {
  private readonly logger = new Logger(ScoringClient.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ConfigService) {
    this.baseUrl = (config.get<string>('SCORING_API_URL') || 'http://127.0.0.1:8000').replace(
      /\/$/,
      '',
    );
    this.apiKey = config.get<string>('SCORING_API_KEY') || '';
  }

  async post<TResponse, TBody = unknown>(
    path: string,
    body: TBody,
    options: { timeoutMs?: number } = {},
  ): Promise<TResponse> {
    const url = `${this.baseUrl}${path}`;
    // Perhitungan IRT pada ujian besar bisa berjalan puluhan detik. Batas waktu
    // dipasang eksplisit supaya permintaan yang menggantung tidak menahan
    // koneksi NestJS tanpa batas.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text();
      const parsed = text ? JSON.parse(text) : null;

      if (!response.ok) {
        const detail = parsed?.detail || parsed?.error || `HTTP ${response.status}`;

        // Status 4xx dari FastAPI adalah masalah DATA, bukan layanan mati —
        // mis. "esai belum dinilai" atau "tidak ada sistem penilaian IRT yang
        // dipilih". Statusnya diteruskan apa adanya supaya pesan itu sampai ke
        // guru sebagai kesalahan yang bisa ia perbaiki, bukan sebagai 503 yang
        // terbaca seolah servernya sedang bermasalah.
        if (response.status >= 400 && response.status < 500) {
          throw new HttpException(detail, response.status);
        }
        throw new ServiceUnavailableException(`Layanan skoring menolak permintaan: ${detail}`);
      }
      return parsed as TResponse;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const message =
        (error as Error)?.name === 'AbortError'
          ? 'Layanan skoring tidak merespons tepat waktu.'
          : (error as Error).message;
      this.logger.error(`Panggilan ${path} gagal: ${message}`);
      throw new ServiceUnavailableException(message);
    }
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      return { ok: response.ok };
    } catch (error) {
      return { ok: false, detail: (error as Error).message };
    }
  }
}
