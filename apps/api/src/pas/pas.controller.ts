import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    Put,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@acca-cbt/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
    AssignRoomStudentsDto,
    AssignUsersDto,
    CreatePASPeriodDto,
    CreatePASRoomDto,
    CreatePASScheduleDto,
    CreatePASSessionDto,
    GeneratePASExamsDto,
    LockPASPeriodDto,
} from './dto/pas.dto';
import { PasRoomsService } from './pas-rooms.service';
import { PasSchedulesService } from './pas-schedules.service';
import { PasService } from './pas.service';

/**
 * Penilaian Akhir Semester / Tahun (PAS/PAT).
 *
 * `@Roles` hanya saringan kasar "bukan siswa". Pembedaan baca (staf) dan tulis
 * (Proktor/Admin) beserta pemeriksaan organisasinya ada di service.
 */
@ApiTags('pas')
@ApiBearerAuth()
@Controller('pas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'PROKTOR', 'GURU')
export class PasController {
    constructor(
        private readonly pas: PasService,
        private readonly schedules: PasSchedulesService,
        private readonly rooms: PasRoomsService,
    ) {}

    // ── Periode ──────────────────────────────────────────────────────────────

    @Get('periods')
    @ApiOperation({ summary: 'Daftar periode PAS satu organisasi' })
    async listPeriods(
        @CurrentUser() user: AuthUser,
        @Query('organizationId', ParseUUIDPipe) organizationId: string,
    ) {
        return { periods: await this.pas.listPeriods(user, organizationId) };
    }

    @Get('periods/:periodId')
    @ApiOperation({ summary: 'Satu periode beserta jadwal kelasnya' })
    async getPeriod(
        @CurrentUser() user: AuthUser,
        @Param('periodId', ParseUUIDPipe) periodId: string,
    ) {
        return { period: await this.pas.getPeriod(user, periodId) };
    }

    @Post('periods')
    @ApiOperation({ summary: 'Buat periode PAS baru' })
    createPeriod(@CurrentUser() user: AuthUser, @Body() dto: CreatePASPeriodDto) {
        return this.pas.createPeriod(user, dto);
    }

    @Post('periods/:periodId/lock')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Kunci atau buka kunci periode' })
    lockPeriod(
        @CurrentUser() user: AuthUser,
        @Param('periodId', ParseUUIDPipe) periodId: string,
        @Body() dto: LockPASPeriodDto,
    ) {
        return this.pas.setPeriodLock(user, periodId, dto.lock);
    }

    @Delete('periods/:periodId')
    @ApiOperation({ summary: 'Hapus periode PAS' })
    removePeriod(
        @CurrentUser() user: AuthUser,
        @Param('periodId', ParseUUIDPipe) periodId: string,
    ) {
        return this.pas.removePeriod(user, periodId);
    }

    // ── Data pendukung ───────────────────────────────────────────────────────

    @Get('subjects')
    @ApiOperation({ summary: 'Mata pelajaran aktif dari master data acca-app' })
    async listSubjects(
        @CurrentUser() user: AuthUser,
        @Query('organizationId', ParseUUIDPipe) organizationId: string,
    ) {
        return { subjects: await this.pas.listSubjects(user, organizationId) };
    }

    @Get('classes')
    @ApiOperation({ summary: 'Kelas satu organisasi beserta jumlah siswanya' })
    async listClasses(
        @CurrentUser() user: AuthUser,
        @Query('organizationId', ParseUUIDPipe) organizationId: string,
        @Query('activeYearOnly') activeYearOnly?: string,
    ) {
        return {
            classes: await this.pas.listClasses(user, organizationId, activeYearOnly === 'true'),
        };
    }

    @Get('staff')
    @ApiOperation({ summary: 'Guru dan pengawas organisasi, untuk penugasan ruang' })
    async listStaff(
        @CurrentUser() user: AuthUser,
        @Query('organizationId', ParseUUIDPipe) organizationId: string,
    ) {
        return { staff: await this.pas.listStaff(user, organizationId) };
    }

    // ── Sesi ─────────────────────────────────────────────────────────────────

    @Get('periods/:periodId/sessions')
    @ApiOperation({ summary: 'Sesi waktu sebuah periode' })
    async listSessions(
        @CurrentUser() user: AuthUser,
        @Param('periodId', ParseUUIDPipe) periodId: string,
    ) {
        return { sessions: await this.schedules.listSessions(user, periodId) };
    }

    @Post('periods/:periodId/sessions')
    @ApiOperation({ summary: 'Tambah sesi waktu' })
    createSession(
        @CurrentUser() user: AuthUser,
        @Param('periodId', ParseUUIDPipe) periodId: string,
        @Body() dto: CreatePASSessionDto,
    ) {
        return this.schedules.createSession(user, periodId, dto);
    }

    @Delete('sessions/:sessionId')
    @ApiOperation({ summary: 'Hapus sesi waktu' })
    removeSession(
        @CurrentUser() user: AuthUser,
        @Param('sessionId', ParseUUIDPipe) sessionId: string,
    ) {
        return this.schedules.removeSession(user, sessionId);
    }

    // ── Jadwal ───────────────────────────────────────────────────────────────

    @Post('schedules')
    @ApiOperation({ summary: 'Jadwalkan satu bank soal untuk satu kelas' })
    addSchedule(@CurrentUser() user: AuthUser, @Body() dto: CreatePASScheduleDto) {
        return this.schedules.addSchedule(user, dto);
    }

    @Delete('schedules/:scheduleId')
    @ApiOperation({ summary: 'Hapus jadwal beserta ujian hasil bangkitannya' })
    removeSchedule(
        @CurrentUser() user: AuthUser,
        @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    ) {
        return this.schedules.removeSchedule(user, scheduleId);
    }

    @Post('schedules/generate')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Bangkitkan ujian sungguhan dari jadwal terpilih' })
    generate(@CurrentUser() user: AuthUser, @Body() dto: GeneratePASExamsDto) {
        return this.schedules.generate(user, dto.scheduleIds);
    }

    // ── Ruang ────────────────────────────────────────────────────────────────

    @Get('periods/:periodId/rooms')
    @ApiOperation({ summary: 'Ruang ujian beserta pengawas dan pesertanya' })
    async listRooms(
        @CurrentUser() user: AuthUser,
        @Param('periodId', ParseUUIDPipe) periodId: string,
    ) {
        return { rooms: await this.rooms.listRooms(user, periodId) };
    }

    @Post('periods/:periodId/rooms')
    @ApiOperation({ summary: 'Tambah ruang ujian' })
    createRoom(
        @CurrentUser() user: AuthUser,
        @Param('periodId', ParseUUIDPipe) periodId: string,
        @Body() dto: CreatePASRoomDto,
    ) {
        return this.rooms.createRoom(user, periodId, dto);
    }

    @Delete('rooms/:roomId')
    @ApiOperation({ summary: 'Hapus ruang ujian' })
    removeRoom(@CurrentUser() user: AuthUser, @Param('roomId', ParseUUIDPipe) roomId: string) {
        return this.rooms.removeRoom(user, roomId);
    }

    @Put('rooms/:roomId/invigilators')
    @ApiOperation({ summary: 'Ganti seluruh daftar pengawas satu ruang' })
    assignInvigilators(
        @CurrentUser() user: AuthUser,
        @Param('roomId', ParseUUIDPipe) roomId: string,
        @Body() dto: AssignUsersDto,
    ) {
        return this.rooms.assignInvigilators(user, roomId, dto.userIds);
    }

    @Put('periods/:periodId/room-students')
    @ApiOperation({ summary: 'Tugaskan peserta ke sebuah ruang dalam periode ini' })
    assignStudents(
        @CurrentUser() user: AuthUser,
        @Param('periodId', ParseUUIDPipe) periodId: string,
        @Body() dto: AssignRoomStudentsDto,
    ) {
        return this.rooms.assignStudents(user, periodId, dto.roomId, dto.userIds);
    }

    @Delete('periods/:periodId/room-students/:userId')
    @ApiOperation({ summary: 'Keluarkan seorang peserta dari ruangnya' })
    removeStudent(
        @CurrentUser() user: AuthUser,
        @Param('periodId', ParseUUIDPipe) periodId: string,
        @Param('userId', ParseUUIDPipe) userId: string,
    ) {
        return this.rooms.removeStudent(user, periodId, userId);
    }
}
