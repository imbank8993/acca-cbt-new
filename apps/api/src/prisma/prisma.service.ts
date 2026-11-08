import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { withPoolDefaults } from './database-url';

function prismaClientOptions(): { datasourceUrl: string } | undefined {
  const datasourceUrl = withPoolDefaults(process.env.DATABASE_URL);
  return datasourceUrl ? { datasourceUrl } : undefined;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Pool bawaan Prisma (~13 koneksi di VPS 6 core) terlalu kecil untuk pengumpulan
    // ujian serentak; lihat database-url.ts.
    super(prismaClientOptions());
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Prisma Client terhubung ke PostgreSQL (acca_db)');
    } catch (error) {
      // Koneksi tidak diputus paksa: Prisma menyambung ulang secara malas pada
      // query pertama. Membuat bootstrap gagal di sini berarti seluruh API mati
      // hanya karena database sempat tidak terjangkau saat start.
      this.logger.warn(
        `Koneksi Prisma tertunda: ${(error as Error).message}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Prisma Client terputus dari PostgreSQL');
  }
}
