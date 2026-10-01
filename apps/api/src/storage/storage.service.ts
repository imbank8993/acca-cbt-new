import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';

export interface StorageResult {
  success: boolean;
  url?: string;
  key?: string;
  error?: string;
}

/**
 * Ekstensi yang diizinkan → Content-Type saat menyimpan.
 *
 * Content-Type dari klien sengaja diabaikan: jika dipercaya, penyerang
 * bisa menyimpan file dengan tipe `text/html` dan menyajikannya dari
 * bucket publik sebagai halaman HTML.
 */
export const ALLOWED_EXTENSIONS: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private client: S3Client | null = null;
  private bucket = '';
  private publicUrl = '';
  private accountId = '';

  constructor(private readonly config: ConfigService) {
    this.init();
  }

  private init(): void {
    this.accountId = this.config.get<string>('CLOUDFLARE_R2_ACCOUNT_ID') || '';
    const accessKeyId = this.config.get<string>('CLOUDFLARE_R2_ACCESS_KEY_ID') || '';
    const secretAccessKey = this.config.get<string>('CLOUDFLARE_R2_SECRET_ACCESS_KEY') || '';
    this.bucket = this.config.get<string>('CLOUDFLARE_R2_BUCKET_NAME') || '';
    this.publicUrl = (this.config.get<string>('CLOUDFLARE_R2_PUBLIC_URL') || '').replace(/\/+$/, '');

    if (!this.accountId || !accessKeyId || !secretAccessKey || !this.bucket) {
      this.logger.warn(
        'Konfigurasi Cloudflare R2 tidak lengkap. Fitur upload/delete tidak tersedia.',
      );
      return;
    }

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${this.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });

    this.logger.log(`StorageService siap: bucket="${this.bucket}"`);
  }

  /** True bila semua kredensial R2 sudah terisi. */
  isConfigured(): boolean {
    return this.client !== null;
  }

  /** Informasi status tanpa rahasia — aman dikembalikan ke klien. */
  status(): { configured: boolean; provider: 'cloudflare-r2'; bucket: string; publicUrl: string } {
    return {
      configured: this.isConfigured(),
      provider: 'cloudflare-r2',
      bucket: this.bucket,
      publicUrl: this.publicUrl,
    };
  }

  /** URL publik sebuah object key. */
  publicUrlForKey(key: string): string {
    if (this.publicUrl && !this.publicUrl.includes('.r2.dev')) {
      return `${this.publicUrl}/${key}`;
    }
    return `/api/storage/file/${key}`;
  }

  /**
   * Ambil satu objek dari R2 sebagai readable stream dan metadata.
   */
  async getObject(key: string): Promise<{
    stream: Readable;
    contentType: string;
    contentLength?: number;
    etag?: string;
  } | null> {
    if (!this.client) {
      return null;
    }

    try {
      const resp = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      if (!resp.Body) return null;
      return {
        stream: resp.Body as unknown as Readable,
        contentType: resp.ContentType || this.resolveContentType(key) || 'application/octet-stream',
        contentLength: resp.ContentLength,
        etag: resp.ETag,
      };
    } catch (err) {
      this.logger.warn(`Gagal mengambil '${key}': ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Ubah URL publik kembali menjadi object key.
   * Mengembalikan null bila URL bukan milik bucket ini.
   */
  objectKeyFromUrl(fileUrl: string): string | null {
    if (!fileUrl) return null;

    const decode = (raw: string): string | null => {
      const key = raw.split('?')[0].replace(/^\/+/, '');
      if (!key) return null;
      try { return decodeURIComponent(key); } catch { return key; }
    };

    if (fileUrl.includes('/api/storage/file/')) {
      const idx = fileUrl.indexOf('/api/storage/file/');
      return decode(fileUrl.slice(idx + '/api/storage/file/'.length));
    }

    const normalizedPublic = this.publicUrl ? this.publicUrl.replace(/\/+$/, '') : '';
    if (normalizedPublic && fileUrl.startsWith(`${normalizedPublic}/`)) {
      return decode(fileUrl.slice(normalizedPublic.length + 1));
    }

    let url: URL;
    try { url = new URL(fileUrl); } catch { return null; }

    // r2.dev is shared by unrelated buckets; only the configured public URL is trusted above.

    if (url.hostname === `${this.accountId}.r2.cloudflarestorage.com`) {
      const parts = url.pathname.replace(/^\/+/, '').split('/');
      if (parts.shift() !== this.bucket) return null;
      return decode(parts.join('/'));
    }

    if (url.hostname === `${this.bucket}.${this.accountId}.r2.cloudflarestorage.com`) {
      return decode(url.pathname);
    }

    return null;
  }

  /** Validasi ekstensi file. Kembalikan Content-Type atau null bila tidak diizinkan. */
  resolveContentType(originalName: string): string | null {
    const parts = (originalName || '').split('.');
    if (parts.length < 2) return null;
    const ext = (parts.pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return ALLOWED_EXTENSIONS[ext] ?? null;
  }

  /** Buat nama file unik: `{timestamp}_{random}.{ext}` */
  generateFileName(originalName: string): string {
    const parts = (originalName || 'file').split('.');
    const ext = parts.length > 1 ? (parts.pop() || '').toLowerCase() : 'bin';
    return `${Date.now()}_${randomBytes(4).toString('hex')}.${ext}`;
  }

  /** Simpan satu objek ke R2. */
  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<StorageResult> {
    if (!this.client) {
      return { success: false, error: 'Penyimpanan belum dikonfigurasi. Periksa CLOUDFLARE_R2_* di environment.' };
    }

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
      return { success: true, key, url: this.publicUrlForKey(key) };
    } catch (err) {
      const message = (err as Error).message || String(err);
      this.logger.error(`Gagal menyimpan '${key}': ${message}`);
      return { success: false, error: message };
    }
  }

  /** Hapus satu objek dari R2 berdasarkan key. */
  async deleteObject(key: string): Promise<{ success: boolean; error?: string }> {
    if (!this.client) {
      return { success: false, error: 'Penyimpanan belum dikonfigurasi.' };
    }

    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { success: true };
    } catch (err) {
      const message = (err as Error).message || String(err);
      this.logger.warn(`Gagal menghapus '${key}': ${message}`);
      return { success: false, error: message };
    }
  }

  /**
   * Hapus objek dari URL publiknya.
   * URL yang bukan milik bucket ini dilewati tanpa galat.
   */
  async deleteObjectByUrl(fileUrl: string): Promise<{ success: boolean; error?: string }> {
    const key = this.objectKeyFromUrl(fileUrl);
    if (!key) return { success: false, error: 'URL bukan objek penyimpanan yang dikenali.' };
    return this.deleteObject(key);
  }

  /** Uji koneksi ke bucket — dipakai health check. */
  async testConnection(): Promise<{ success: boolean; message?: string; error?: string }> {
    if (!this.client) {
      return { success: false, error: 'Konfigurasi R2 tidak lengkap.' };
    }

    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { success: true, message: `Terhubung ke Cloudflare R2, bucket "${this.bucket}".` };
    } catch (err) {
      const message = (err as Error).message || String(err);
      if (message.includes('403') || message.includes('Forbidden')) {
        return { success: false, error: 'R2: akses ditolak. Periksa Access Key ID dan Secret.' };
      }
      if (message.includes('404') || message.includes('NoSuchBucket')) {
        return { success: false, error: `R2: bucket "${this.bucket}" tidak ditemukan.` };
      }
      return { success: false, error: `R2: ${message}` };
    }
  }
}
