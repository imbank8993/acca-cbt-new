import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { AuthUser } from '@acca-cbt/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RateLimit, RateLimitGuard } from '../common/rate-limit';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProctoringService, STUDENT_SECURITY_EVENTS } from './proctoring.service';
import type { Request } from 'express';
import { examClientContext } from '../common/exam-client-context';

class LogViolationDto {
    @ApiProperty({ example: 'tab_switch' })
    @IsString()
    @IsIn(STUDENT_SECURITY_EVENTS)
    @IsNotEmpty({ message: 'Jenis event wajib diisi' })
    eventType!: string;

    @ApiProperty({ required: false })
    @IsOptional()
    @IsObject()
    metadata?: Record<string, unknown>;

    @ApiProperty({ required: false, description: 'ID idempoten dari antrean browser' })
    @IsOptional()
    @IsUUID()
    clientEventId?: string;
}

class SyncHealthDto {
    @IsOptional() @IsObject()
    interruption?: { at: string; remainingSeconds: number; reason: 'browser_offline' | 'server_unreachable' };

    @IsInt() @Min(0) @Max(10000)
    localAnswerCount!: number;

    @IsInt() @Min(0) @Max(10000)
    pendingAnswerCount!: number;

    @IsIn(['healthy', 'fallback', 'unavailable', 'unknown'])
    storageState!: 'healthy' | 'fallback' | 'unavailable' | 'unknown';
}

class HeartbeatDto {
    @ApiProperty({ required: false })
    @IsOptional() @IsDateString()
    sessionStartedAt?: string;

    @ApiProperty({ required: false })
    @IsOptional() @IsDateString()
    screenSharingObservedAt?: string;

    @IsOptional() @ValidateNested() @Type(() => SyncHealthDto)
    syncHealth?: SyncHealthDto;

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    @Length(8, 200)
    deviceId!: string;

    @ApiProperty({ required: false, description: 'Status berbagi layar menurut browser (ujian dengan screenshot).' })
    @IsOptional() @IsBoolean()
    screenSharing?: boolean;
}

class TerminateDto {
    @ApiProperty({ example: 'Melebihi batas pelanggaran' })
    @IsString()
    @IsNotEmpty({ message: 'Alasan wajib diisi' })
    reason!: string;
}

class ResetAttemptDto {
    @ApiProperty({ example: 'Jaringan siswa terputus sampai melewati batas waktu.' })
    @IsString()
    @Length(5, 500)
    reason!: string;

    @ApiProperty({
        required: true,
        example: 15,
        minimum: 1,
        maximum: 1440,
        description: 'Durasi pemulihan dalam menit, dihitung sejak pengawas mengaktifkan pemulihan.',
    })
    @IsInt()
    @Min(1)
    @Max(1440)
    durationMinutes!: number;
}

class MakeupAttemptDto extends ResetAttemptDto {
    @ApiProperty({
        required: true,
        example: 90,
        minimum: 1,
        maximum: 1440,
        description: 'Waktu ujian susulan dalam menit, dihitung sejak pengawas mengaktifkan susulan.',
    })
    @IsInt()
    @Min(1)
    @Max(1440)
    durationMinutes!: number;

    @ApiProperty({
        required: false,
        description: 'Kunci idempoten untuk percobaan ulang saat respons jaringan hilang.',
    })
    @IsOptional()
    @IsUUID()
    clientRequestId?: string;
}

@ApiTags('proctoring')
@ApiBearerAuth()
@Controller('proctoring')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class ProctoringController {
    constructor(private readonly proctoring: ProctoringService) {}

    @RateLimit({ name: 'proctoring-violations', limit: 120, windowMs: 60_000 })
    @Post('attempts/:attemptId/violations')
    @ApiOperation({ summary: 'Catat pelanggaran keamanan selama ujian' })
    logViolation(
        @CurrentUser() user: AuthUser,
        @Param('attemptId', ParseUUIDPipe) attemptId: string,
        @Body() dto: LogViolationDto,
    ) {
        return this.proctoring.logViolation(
            user,
            attemptId,
            dto.eventType,
            dto.metadata ?? {},
            dto.clientEventId,
        );
    }

    @RateLimit({ name: 'proctoring-heartbeat', limit: 20, windowMs: 60_000 })
    @Post('attempts/:attemptId/heartbeat')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Perbarui status koneksi peserta selama ujian' })
    heartbeat(
        @CurrentUser() user: AuthUser,
        @Param('attemptId', ParseUUIDPipe) attemptId: string,
        @Body() dto: HeartbeatDto,
        @Req() request: Request,
    ) {
        return this.proctoring.heartbeat(user, attemptId, dto.deviceId, dto.syncHealth, examClientContext(request), dto.screenSharing, dto.sessionStartedAt, dto.screenSharingObservedAt);
    }

    @Post('attempts/:attemptId/reset')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Atur ulang waktu pengerjaan dengan jawaban tetap tersimpan' })
    async reset(
        @CurrentUser() user: AuthUser,
        @Param('attemptId', ParseUUIDPipe) attemptId: string,
        @Body() dto: ResetAttemptDto,
    ) {
        return this.proctoring.resetAttempt(user, attemptId, dto.reason, dto.durationMinutes);
    }

    @Post('attempts/:attemptId/makeup')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Mulai ulang ujian seorang siswa dan hapus jawaban lama' })
    async makeup(
        @CurrentUser() user: AuthUser,
        @Param('attemptId', ParseUUIDPipe) attemptId: string,
        @Body() dto: MakeupAttemptDto,
    ) {
        return this.proctoring.startMakeupAttempt(
            user,
            attemptId,
            dto.reason,
            dto.durationMinutes,
            dto.clientRequestId,
        );
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
