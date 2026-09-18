import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import type { AuthUser } from '@acca-cbt/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProctoringService } from './proctoring.service';

class LogViolationDto {
    @ApiProperty({ example: 'tab_switch' })
    @IsString()
    @IsNotEmpty({ message: 'Jenis event wajib diisi' })
    eventType!: string;

    @ApiProperty({ required: false })
    @IsOptional()
    @IsObject()
    metadata?: Record<string, unknown>;
}

class TerminateDto {
    @ApiProperty({ example: 'Melebihi batas pelanggaran' })
    @IsString()
    @IsNotEmpty({ message: 'Alasan wajib diisi' })
    reason!: string;
}

@ApiTags('proctoring')
@ApiBearerAuth()
@Controller('proctoring')
@UseGuards(JwtAuthGuard)
export class ProctoringController {
    constructor(private readonly proctoring: ProctoringService) {}

    @Post('attempts/:attemptId/violations')
    @ApiOperation({ summary: 'Catat pelanggaran keamanan selama ujian' })
    logViolation(
        @CurrentUser() user: AuthUser,
        @Param('attemptId', ParseUUIDPipe) attemptId: string,
        @Body() dto: LogViolationDto,
    ) {
        return this.proctoring.logViolation(user, attemptId, dto.eventType, dto.metadata ?? {});
    }

    @Post('attempts/:attemptId/reset')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Kembalikan pengerjaan yang sudah tertutup ke berjalan' })
    async reset(
        @CurrentUser() user: AuthUser,
        @Param('attemptId', ParseUUIDPipe) attemptId: string,
    ) {
        await this.proctoring.resetAttempt(user, attemptId);
        return { attemptId };
    }

    @Post('attempts/:attemptId/terminate')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Hentikan paksa pengerjaan' })
    async terminate(
        @CurrentUser() user: AuthUser,
        @Param('attemptId', ParseUUIDPipe) attemptId: string,
        @Body() dto: TerminateDto,
    ) {
        await this.proctoring.forceTerminate(user, attemptId, dto.reason);
        return { attemptId };
    }
}
