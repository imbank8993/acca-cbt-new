import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@acca-cbt/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { GradingService } from './grading.service';
import { ExamKeyCorrectionService } from './exam-key-correction.service';
import { ExamKeyCorrectionDto } from './exam-key-correction.dto';

@ApiTags('grading')
@ApiBearerAuth()
@Controller('grading')
@UseGuards(JwtAuthGuard)
export class GradingController {
    constructor(private readonly grading: GradingService, private readonly correction: ExamKeyCorrectionService) {}

    @Get('keys/:examId')
    getKeys(@CurrentUser() user: AuthUser, @Param('examId', ParseUUIDPipe) examId: string) {
        return this.correction.get(user, examId);
    }
    @Post('keys/:examId')
    @HttpCode(HttpStatus.OK)
    correctKeys(@CurrentUser() user: AuthUser, @Param('examId', ParseUUIDPipe) examId: string, @Body() dto: ExamKeyCorrectionDto) {
        return this.correction.save(user, examId, dto);
    }
    @Post('keys/:examId/recalculate')
    @HttpCode(HttpStatus.OK)
    recalculateKeys(@CurrentUser() user: AuthUser, @Param('examId', ParseUUIDPipe) examId: string) {
        return this.correction.recalculate(user, examId);
    }

    @Post('irt/:examId')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Hitung skor IRT seluruh peserta satu ujian' })
    calculateIrt(
        @CurrentUser() user: AuthUser,
        @Param('examId', ParseUUIDPipe) examId: string,
    ) {
        // Tanpa @Roles: aturannya bergantung pada jenis ujian dan kepemilikannya,
        // bukan sekadar nama peran — lihat AuthorizationService.assertExamStaff.
        return this.grading.calculateIrt(user, examId);
    }
}
