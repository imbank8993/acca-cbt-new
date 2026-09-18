import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@acca-cbt/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { GradingService } from './grading.service';

@ApiTags('grading')
@ApiBearerAuth()
@Controller('grading')
@UseGuards(JwtAuthGuard)
export class GradingController {
    constructor(private readonly grading: GradingService) {}

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
