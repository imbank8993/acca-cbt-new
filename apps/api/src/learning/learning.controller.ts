import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthUser } from '@acca-cbt/shared';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentSchoolId } from '../common/decorators/current-school-id.decorator';
import { MAX_UPLOAD_BYTES } from '../storage/storage.service';
import { CreateMaterialDto, ProgressDto, UpdateMaterialDto } from './learning.dto';
import { LearningService } from './learning.service';

@Controller('learning')
@UseGuards(JwtAuthGuard)
export class LearningController {
    constructor(private readonly learning: LearningService) {}
    @Get()
    list(@CurrentUser() user: AuthUser, @CurrentSchoolId() org: string, @Query('manage') manage?: string) { return this.learning.list(user, org, manage === '1'); }
    @Post()
    create(@CurrentUser() user: AuthUser, @CurrentSchoolId() org: string, @Body() dto: CreateMaterialDto) { return this.learning.create(user, org, dto); }
    @Get(':id')
    detail(@CurrentUser() user: AuthUser, @CurrentSchoolId() org: string, @Param('id', ParseUUIDPipe) id: string) { return this.learning.detail(user, org, id); }
    @Put(':id')
    update(@CurrentUser() user: AuthUser, @CurrentSchoolId() org: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMaterialDto) { return this.learning.update(user, org, id, dto); }
    @Post(':id/file')
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 1 } }))
    upload(@CurrentUser() user: AuthUser, @CurrentSchoolId() org: string, @Param('id', ParseUUIDPipe) id: string,
        @UploadedFile() file: Express.Multer.File | undefined, @Body('revision', ParseIntPipe) revision: number) { return this.learning.upload(user, org, id, file, revision); }
    @Get(':id/file')
    async file(@CurrentUser() user: AuthUser, @CurrentSchoolId() org: string, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
        const { object, name } = await this.learning.file(user, org, id);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, no-store');
        if (object.contentLength !== undefined) res.setHeader('Content-Length', object.contentLength);
        object.stream.on('error', () => res.destroy());
        object.stream.pipe(res);
    }
    @Put(':id/progress')
    progress(@CurrentUser() user: AuthUser, @CurrentSchoolId() org: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProgressDto) { return this.learning.progress(user, org, id, dto.completed); }
}
