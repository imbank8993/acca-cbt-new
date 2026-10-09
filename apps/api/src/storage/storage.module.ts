import { APP_INTERCEPTOR } from '@nestjs/core';
import { StorageUrlsInterceptor } from './storage-urls.interceptor';
import { StorageAuthGuard } from './storage-auth.guard';
import { StorageAccessService } from './storage-access.service';
import { Global, Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

/**
 * Modul penyimpanan berkas — Cloudflare R2.
 *
 * Di-export global agar service yang lain (misalnya backup atau soal)
 * bisa inject StorageService tanpa perlu import StorageModule berulang.
 */
@Global()
@Module({
  imports: [
    MulterModule.register({
      // Simpan di memori. File soal/gambar tidak besar sehingga tidak perlu
      // disk temp yang memerlukan cleanup manual. Bila suatu saat ada file
      // sangat besar, ganti ke DiskStorage di sini — tanpa ubah controller.
      storage: undefined,
    }),
  ],
  controllers: [StorageController],
  providers: [StorageService, StorageAccessService, StorageAuthGuard, { provide: APP_INTERCEPTOR, useClass: StorageUrlsInterceptor }],
  exports: [StorageService],
})
export class StorageModule {}
