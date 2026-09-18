import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@acca-cbt/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ExamReviewService } from './exam-review.service';

@ApiTags('exam-review')
@ApiBearerAuth()
@Controller('exam-review')
@UseGuards(JwtAuthGuard)
export class ExamReviewController {
    constructor(private readonly review: ExamReviewService) {}

    @Get('attempts/:attemptId')
    @ApiOperation({ summary: 'Review hasil ujian: jawaban pemanggil berikut kunci jawaban' })
    async getReview(
        @CurrentUser() user: AuthUser,
        @Param('attemptId', ParseUUIDPipe) attemptId: string,
    ) {
        return { review: await this.review.getReview(user, attemptId) };
    }
}
