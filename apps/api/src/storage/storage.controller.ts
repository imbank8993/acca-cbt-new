import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Body,
  Get,
  Req,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@acca-cbt/shared';
import type { Request, Response } from 'express';
import { AllowInternalKey } from '../auth/allow-internal-key.decorator';
import { StorageAuthGuard } from './storage-auth.guard';
import { StorageAccessService } from './storage-access.service';
import { fileKey, isPublicFile } from './storage-file-policy';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MAX_UPLOAD_BYTES, StorageService } from './storage.service';

/**
 * Folder path yang boleh dikirim klien.
 *
 * Bersihkan segment: buang `..`, karakter berbahaya, dan batasi kedalaman
 * menjadi 4 level. Khusus prefix `assignments/<examId>/<userId>`, segmen
 * userId dipaksa ke id pemanggil — tanpa ini siswa bisa menulis ke folder
 * milik siswa lain hanya dengan mengganti segmen terakhir di path-nya.
 */
function sanitizeFolder(raw: string, callerId: string): string {
  const segments = (raw || 'misc')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.' && s !== '..')
    .map((s) => s.replace(/[^A-Za-z0-9._-]/g, '-'))
    .slice(0, 4);

  if (segments.length === 0) return 'misc';

  // Paksa userId ke identity pemanggil agar tidak bisa menulis ke folder orang lain.
  if (segments[0] === 'assignments') {
    return ['assignments', segments[1] || 'unknown', callerId].join('/');
  }

  return segments.join('/');
}

@ApiTags('storage')
@ApiBearerAuth()
@Controller('storage')
@UseGuards(StorageAuthGuard)
export class StorageController {
  private readonly logger = new Logger(StorageController.name);

  constructor(private readonly storage: StorageService, private readonly access: StorageAccessService) {}

  @Get('status')
  @ApiOperation({ summary: 'Status konfigurasi penyimpanan R2' })
  getStatus() {
    return this.storage.status();
  }

  /**
   * Sajikan berkas dari penyimpanan Cloudflare R2 secara streaming.
   * Lampiran privat memerlukan identitas dan hak akses; hanya avatar/logo yang publik.
   * Proxy web meneruskan cookie sesi sebagai token untuk elemen media.
   */
  @Get('file/*')
  @ApiOperation({ summary: 'Sajikan berkas dari penyimpanan R2 secara streaming' })
  async serveFile(@Req() req: Request, @Res() res: Response, @CurrentUser() user: AuthUser) {
    const key = fileKey(req.url);

    if (key.startsWith('lms-private/')) {
      throw new NotFoundException('Berkas tidak ditemukan.');
    }

    if (!isPublicFile(key)) await this.access.assertRead(user, key);
    const obj = await this.storage.getObject(key);
    if (!obj) {
      throw new NotFoundException('Berkas tidak ditemukan.');
    }

    res.setHeader('Content-Type', obj.contentType);
    if (obj.contentLength !== undefined) {
      res.setHeader('Content-Length', obj.contentLength);
    }
    if (obj.etag) {
      res.setHeader('ETag', obj.etag);
    }
    res.setHeader('Cache-Control', isPublicFile(key) ? 'public, max-age=3600' : 'private, no-store');
    res.setHeader('Vary', 'Cookie, Authorization');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    obj.stream.pipe(res);
  }

  /**
   * Unggah satu berkas ke Cloudflare R2.
   *
   * Request: multipart/form-data
   *   - file: File
   *   - folder: string (opsional, default: 'misc')
   *
   * Aturan keamanan yang dulu ada di Next.js kini ditegakkan di sini:
   *  - Whitelist ekstensi
   *  - Batas ukuran 25 MB
   *  - Sanitasi folder path (termasuk paksa userId untuk `assignments/`)
   *  - Autentikasi JWT wajib (atau INTERNAL_API_KEY untuk antar-service)
   *
   * @AllowInternalKey() membolehkan Next.js (math-equations.ts) mengupload SVG
   * hasil render MathML tanpa token pengguna, menggunakan shared secret.
   */
  @Post('upload')
  @AllowInternalKey()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES },
      storage: undefined,
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        folder: { type: 'string', description: 'Folder tujuan, default: misc' },
      },
      required: ['file'],
    },
  })
  @ApiOperation({ summary: 'Unggah berkas ke Cloudflare R2' })
  async upload(
    @CurrentUser() user: AuthUser | null,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('folder') rawFolder?: string,
  ) {
    if (!file) {
      throw new BadRequestException('File tidak ditemukan.');
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException(
        `File terlalu besar. Maksimum ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
      );
    }

    const contentType = this.storage.resolveContentType(file.originalname);
    if (!contentType) {
      const ext = (file.originalname || '').split('.').pop() || '?';
      throw new BadRequestException(`Jenis file .${ext} tidak diizinkan.`);
    }

    // Panggilan antar-service (math-equations, backup) tidak punya user.
    // Untuk upload user biasa, folder `assignments/` dikunci ke userId.
    const callerId = user?.id ?? 'internal';
    const folder = sanitizeFolder(rawFolder || 'misc', callerId);
    const fileName = this.storage.generateFileName(file.originalname);
    const ownedFolder = user && !folder.startsWith('assignments/')
      ? `users/${user.id}/${folder}` : folder;
    const key = `${ownedFolder}/${fileName}`;

    const result = await this.storage.putObject(key, file.buffer, contentType);
    if (!result.success) {
      this.logger.error(`Upload gagal (caller=${callerId}): ${result.error}`);
      throw new InternalServerErrorException(result.error || 'Gagal menyimpan file.');
    }

    return { success: true, url: result.url, key: result.key, provider: 'cloudflare-r2' };
  }

  /**
   * Hapus satu objek dari R2 berdasarkan URL publiknya.
   *
   * Request JSON: `{ url: string }`
   *
   * Aturan kepemilikan: lampiran jawaban (`assignments/`) hanya boleh dihapus
   * oleh pembuatnya. Aturan ini dipaksa di sini, bukan di browser.
   */
  @Delete('upload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hapus objek dari R2 berdasarkan URL publiknya' })
  async remove(
    @CurrentUser() user: AuthUser,
    @Body() body: { url?: string },
  ) {
    const fileUrl = body?.url || '';
    if (!fileUrl || (!/^https?:\/\//.test(fileUrl) && !fileUrl.startsWith('/api/storage/file/'))) {
      throw new BadRequestException('URL tidak valid.');
    }

    const key = this.storage.objectKeyFromUrl(fileUrl);
    if (!key) {
      throw new BadRequestException('URL bukan objek penyimpanan yang dikenali.');
    }

    const segments = key.split('/');
    const ownerId = segments[0] === 'assignments' ? segments[2]
      : segments[0] === 'users' ? segments[1] : null;
    // Legacy/shared objects have no provable user owner; only trusted cleanup paths may delete them.
    if (!ownerId || ownerId !== user.id || segments.some(segment => segment === '..' || segment === '.')) {
      throw new ForbiddenException('Tidak diizinkan menghapus file ini.');
    }

    const result = await this.storage.deleteObject(key);
    if (!result.success) {
      throw new InternalServerErrorException(result.error || 'Gagal menghapus file.');
    }

    return { success: true, provider: 'cloudflare-r2' };
  }
}
