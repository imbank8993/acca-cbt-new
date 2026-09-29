import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DbService } from '../prisma/prisma-db-adapter';
import { PrismaService } from '../prisma/prisma.service';
import { RelationRegistry } from '../prisma/relation-registry';
import { ScoringClient } from '../scoring/scoring.client';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RelationRegistry,
    private readonly db: DbService,
    private readonly scoring: ScoringClient,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Status API, database, adapter query, dan layanan skoring' })
  async check() {
    const startedAt = Date.now();
    const scoringPromise = this.scoring.health();
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ db: string }>>(
        'SELECT current_database() AS db',
      );
      await this.registry.ensureLoaded();

      // Koneksi yang hidup belum berarti jalur datanya bekerja. Pemeriksaan ini
      // menjalankan satu query LEWAT adapter — termasuk resolusi relasi dari
      // foreign key — sehingga kerusakan pada lapisan itu terlihat di sini,
      // bukan baru ketahuan saat permintaan pengguna gagal.
      const { data, error } = await this.db
        .from('cbt_organizations')
        .select('id, name')
        .limit(1)
        .maybeSingle();
      const scoring = await scoringPromise;

      return {
        ok: !error && scoring.ok,
        database: rows[0]?.db ?? null,
        adapter: error ? { ok: false, error: error.message } : { ok: true, sample: !!data },
        scoring,
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const scoring = await scoringPromise;
      return {
        ok: false,
        error: (error as Error).message,
        scoring,
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
