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
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
