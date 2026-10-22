import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res, UseGuards } from '@nestjs/common';
import { IsString, IsUUID, Length, MaxLength } from 'class-validator';
import type { AuthUser } from '@acca-cbt/shared';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ExamScreenshotsService } from './exam-screenshots.service';
import { RateLimit, RateLimitGuard } from '../common/rate-limit';

export class UploadScreenshotDto {
    @IsUUID() clientEventId!: string;
    @IsString() @Length(8, 200) deviceId!: string;
    @IsString() @MaxLength(273068) imageBase64!: string;
}

@Controller('proctoring')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class ExamScreenshotsController {
    constructor(private readonly screenshots: ExamScreenshotsService) {}
    @RateLimit({ name: 'proctoring-screenshots', limit: 30, windowMs: 60_000 })
    @Post('attempts/:attemptId/screenshots')
    upload(@CurrentUser() user: AuthUser, @Param('attemptId', ParseUUIDPipe) attemptId: string, @Body() dto: UploadScreenshotDto) {
        return this.screenshots.upload(user, attemptId, dto.clientEventId, dto.deviceId, dto.imageBase64);
    }
    @Get('attempts/:attemptId/screenshots')
    async list(@CurrentUser() user: AuthUser, @Param('attemptId', ParseUUIDPipe) attemptId: string) {
        return { screenshots: await this.screenshots.list(user, attemptId) };
    }
    @Get('screenshots/:id/image')
    async image(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() response: Response) {
        const image = await this.screenshots.read(user, id);
        response.setHeader('Content-Type', image.contentType);
        response.setHeader('Cache-Control', 'private, no-store');
        response.setHeader('Vary', 'Cookie, Authorization');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.send(image.body);
    }
}
