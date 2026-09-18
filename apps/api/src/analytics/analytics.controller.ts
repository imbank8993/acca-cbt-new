import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@acca-cbt/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';

/**
 * Analisis hasil ujian untuk staf.
 *
 * `@Roles` di sini hanyalah saringan kasar "bukan siswa". Pembatasan sebenarnya
 * ada di service lewat `assertExamStaff` / `assertOrgStaff`, yang memeriksa
 * organisasi dan kepemilikan ujian — seorang Guru dari sekolah lain lolos
 * `@Roles` tetapi tetap ditolak di sana.
 */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'PROKTOR', 'GURU')
export class AnalyticsController {
    constructor(private readonly analytics: AnalyticsService) {}

    @Get('exams')
    @ApiOperation({ summary: 'Daftar ujian satu organisasi beserta ringkasan nilainya' })
    async examsWithStats(
        @CurrentUser() user: AuthUser,
        @Query('organizationId', ParseUUIDPipe) organizationId: string,
    ) {
        return { exams: await this.analytics.examsWithStats(user, organizationId) };
    }

    @Get('exams/:examId')
    @ApiOperation({ summary: 'Analisis satu ujian: sebaran nilai dan analisis butir' })
    async examAnalytics(
        @CurrentUser() user: AuthUser,
        @Param('examId', ParseUUIDPipe) examId: string,
    ) {
        return { analytics: await this.analytics.examAnalytics(user, examId) };
    }

    @Get('exams/:examId/students')
    @ApiOperation({ summary: 'Peringkat peserta satu ujian' })
    async studentPerformance(
        @CurrentUser() user: AuthUser,
        @Param('examId', ParseUUIDPipe) examId: string,
    ) {
        return { students: await this.analytics.studentPerformance(user, examId) };
    }

    @Get('exams/:examId/export')
    @ApiOperation({ summary: 'Data mentah rekap ujian untuk diunduh' })
    async examExportData(
        @CurrentUser() user: AuthUser,
        @Param('examId', ParseUUIDPipe) examId: string,
    ) {
        return this.analytics.examExportData(user, examId);
    }

    @Get('exams/:examId/questions/:questionId/responses')
    @ApiOperation({ summary: 'Respons seluruh peserta terhadap satu soal' })
    async questionResponses(
        @CurrentUser() user: AuthUser,
        @Param('examId', ParseUUIDPipe) examId: string,
        @Param('questionId', ParseUUIDPipe) questionId: string,
    ) {
        return this.analytics.questionResponses(user, examId, questionId);
    }

    @Get('attempts/:attemptId/review')
    @ApiOperation({ summary: 'Seluruh jawaban satu pengerjaan berikut kunci jawabannya' })
    async attemptReview(
        @CurrentUser() user: AuthUser,
        @Param('attemptId', ParseUUIDPipe) attemptId: string,
    ) {
        return this.analytics.attemptReviewForStaff(user, attemptId);
    }
}
