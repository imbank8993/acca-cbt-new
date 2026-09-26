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
import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type { AuthUser } from '@acca-cbt/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProctoringService, STUDENT_SECURITY_EVENTS } from './proctoring.service';

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

class HeartbeatDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    deviceId!: string;
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
        return this.proctoring.logViolation(
            user,
            attemptId,
            dto.eventType,
            dto.metadata ?? {},
            dto.clientEventId,
        );
    }

    @Post('attempts/:attemptId/heartbeat')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Perbarui status koneksi peserta selama ujian' })
    heartbeat(
        @CurrentUser() user: AuthUser,
        @Param('attemptId', ParseUUIDPipe) attemptId: string,
        @Body() dto: HeartbeatDto,
    ) {
        return this.proctoring.heartbeat(user, attemptId, dto.deviceId);
    }

    @Post('attempts/:attemptId/reset')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Kembalikan pengerjaan yang sudah tertutup ke berjalan' })
    async reset(
        @CurrentUser() user: AuthUser,
        @Param('attemptId', ParseUUIDPipe) attemptId: string,
        @Body() dto: ResetAttemptDto,
    ) {
        return this.proctoring.resetAttempt(user, attemptId, dto.reason);
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
