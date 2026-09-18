import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@acca-cbt/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { StudentAnalyticsService } from './student-analytics.service';

/**
 * Analisis performa siswa atas DIRINYA SENDIRI.
 *
 * Tidak ada endpoint yang menerima id siswa. Itu bukan kelalaian: versi server
 * action-nya menerima `userId` dari browser tanpa verifikasi, sehingga seluruh
 * rekap siswa lain bisa dibaca hanya dengan menukar UUID.
 */
@ApiTags('student-analytics')
@ApiBearerAuth()
@Controller('student-analytics')
@UseGuards(JwtAuthGuard)
export class StudentAnalyticsController {
    constructor(private readonly analytics: StudentAnalyticsService) {}

    @Get()
    @ApiOperation({ summary: 'Rekap analitik lengkap milik pemanggil' })
    async overview(@CurrentUser() user: AuthUser) {
        return { analytics: await this.analytics.overview(user) };
    }

    @Get('history')
    @ApiOperation({ summary: 'Riwayat ujian yang telah diselesaikan pemanggil' })
    async history(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
        const parsed = Number(limit);
        return {
            history: await this.analytics.history(
                user,
                Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 20,
            ),
        };
    }

    @Get('comparison')
    @ApiOperation({ summary: 'Perbandingan rata-rata pemanggil dengan rata-rata sekolahnya' })
    async comparison(@CurrentUser() user: AuthUser) {
        return { comparison: await this.analytics.comparison(user) };
    }
}
