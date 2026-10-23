import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Patch,
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
import { CurrentSchoolId } from '../common/decorators/current-school-id.decorator';
import {
    ApprovePASAdministrationDto,
    AssignRoomStudentsDto,
    AssignRoomInvigilatorsDto,
    CopyRoomInvigilatorsDto,
    CreatePASPeriodDto,
    CreatePASRoomDto,
    CreatePASScheduleDto,
    CreatePASSessionDto,
    GeneratePASExamsDto,
    PASActivationDto,
    LockPASPeriodDto,
    RejectPASAdministrationDto,
    SavePASAdministrationDto,
    UpdatePASCommitteeChairDto,
    UpdatePASPeriodDto,
} from './dto/pas.dto';
import { PasAdministrationService } from './pas-administration.service';
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
@Roles('ADMIN', 'PROKTOR', 'GURU', 'PENGAWAS')
export class PasController {
    constructor(
        private readonly pas: PasService,
        private readonly schedules: PasSchedulesService,
        private readonly rooms: PasRoomsService,
        private readonly administration: PasAdministrationService,
    ) {}

    // ── Periode ──────────────────────────────────────────────────────────────

    @Get('periods')
    @ApiOperation({ summary: 'Daftar periode PAS satu organisasi' })
    async listPeriods(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
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
    createPeriod(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
        @Body() dto: CreatePASPeriodDto,
    ) {
        return this.pas.createPeriod(user, organizationId, dto);
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

    @Patch('periods/:periodId')
    @Roles('ADMIN', 'PROKTOR')
    @ApiOperation({ summary: 'Perbarui folder ujian (nama, tanggal, ketua panitia, dll)' })
    updatePeriod(
        @CurrentUser() user: AuthUser,
        @Param('periodId', ParseUUIDPipe) periodId: string,
        @Body() dto: UpdatePASPeriodDto,
    ) {
        return this.pas.updatePeriod(user, periodId, dto);
    }

    @Patch('periods/:periodId/committee-chair')
    @Roles('ADMIN', 'PROKTOR')
    @ApiOperation({ summary: 'Perbarui nama & NIP Ketua Panitia pada folder ujian' })
    updateCommitteeChair(
        @CurrentUser() user: AuthUser,
        @Param('periodId', ParseUUIDPipe) periodId: string,
        @Body() dto: UpdatePASCommitteeChairDto,
    ) {
        return this.pas.updateCommitteeChair(user, periodId, dto);
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
        @CurrentSchoolId() organizationId: string,
    ) {
        return { subjects: await this.pas.listSubjects(user, organizationId) };
    }

    @Get('classes')
    @ApiOperation({ summary: 'Kelas satu organisasi beserta jumlah siswanya' })
    async listClasses(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
        @Query('activeYearOnly') activeYearOnly?: string,
    ) {
        return {
            classes: await this.pas.listClasses(user, organizationId, activeYearOnly === 'true'),
        };
    }

    @Get('master-rooms')
    @ApiOperation({ summary: 'Ruang aktif dari master ruang ACCA-new' })
    async listMasterRooms(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
    ) {
        return { rooms: await this.rooms.listMasterRooms(user, organizationId) };
    }

    @Get('staff')
    @ApiOperation({ summary: 'Guru dan pengawas organisasi, untuk penugasan ruang' })
    async listStaff(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
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
    @Put('schedules/:scheduleId/activation')
    setActivation(@CurrentUser() user: AuthUser, @Param('scheduleId', ParseUUIDPipe) scheduleId: string, @Body() dto: PASActivationDto) {
        return this.schedules.setActivation(user, scheduleId, dto.active);
    }

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
    @ApiOperation({ summary: 'Ganti daftar pengawas ruang untuk satu sesi ujian' })
    assignInvigilators(
        @CurrentUser() user: AuthUser,
        @Param('roomId', ParseUUIDPipe) roomId: string,
        @Body() dto: AssignRoomInvigilatorsDto,
    ) {
        return this.rooms.assignInvigilators(user, roomId, dto.userIds, dto.sessionId, dto.examDate);
    }

    @Post('periods/:periodId/invigilators/copy')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Salin seluruh penugasan pengawas (semua ruang & sesi) dari satu tanggal ke tanggal lain' })
    copyInvigilators(
        @CurrentUser() user: AuthUser,
        @Param('periodId', ParseUUIDPipe) periodId: string,
        @Body() dto: CopyRoomInvigilatorsDto,
    ) {
        return this.rooms.copyInvigilators(user, periodId, dto.fromDate, dto.toDate);
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

    // ── Administrasi (Berita Acara & Daftar Hadir) ──────────────────────────

    @Get('my-assignments')
    @ApiOperation({ summary: 'Daftar penugasan ruang & sesi untuk pengawas/proktor' })
    async listMyAssignments(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
    ) {
        return { assignments: await this.administration.listMyAssignments(user, organizationId) };
    }

    @Get('administration/slot')
    @ApiOperation({ summary: 'Data Berita Acara & Daftar Hadir untuk satu ruang, sesi, dan tanggal' })
    async getAdministrationSlot(
        @CurrentUser() user: AuthUser,
        @Query('periodId', ParseUUIDPipe) periodId: string,
        @Query('roomId', ParseUUIDPipe) roomId: string,
        @Query('sessionId', ParseUUIDPipe) sessionId: string,
        @Query('examDate') examDate?: string,
    ) {
        return {
            slot: await this.administration.getAdministrationSlot(user, {
                periodId,
                roomId,
                sessionId,
                examDate,
            }),
        };
    }

    @Put('administration/slot')
    @ApiOperation({ summary: 'Simpan & sahkan Berita Acara beserta Daftar Hadir peserta' })
    async saveAdministrationSlot(
        @CurrentUser() user: AuthUser,
        @Body() dto: SavePASAdministrationDto,
    ) {
        return {
            slot: await this.administration.saveAdministrationSlot(user, dto),
        };
    }

    @Get('administration/overview')
    @ApiOperation({ summary: 'Ringkasan administrasi per ruang & sesi untuk proktor/admin' })
    async getPeriodAdministrationOverview(
        @CurrentUser() user: AuthUser,
        @Query('periodId', ParseUUIDPipe) periodId: string,
    ) {
        return this.administration.getPeriodAdministrationOverview(user, periodId);
    }

    @Post('administration/slot/approve')
    @ApiOperation({ summary: 'Proktor menyetujui (ACC) Berita Acara & Daftar Hadir menjadi dokumen resmi' })
    async approveAdministrationSlot(
        @CurrentUser() user: AuthUser,
        @Body() dto: ApprovePASAdministrationDto,
    ) {
        return {
            slot: await this.administration.approveAdministrationSlot(user, dto),
        };
    }

    @Post('administration/slot/reject')
    @ApiOperation({ summary: 'Proktor mengembalikan Berita Acara & Daftar Hadir untuk perbaikan pengawas' })
    async rejectAdministrationSlot(
        @CurrentUser() user: AuthUser,
        @Body() dto: RejectPASAdministrationDto,
    ) {
        return {
            slot: await this.administration.rejectAdministrationSlot(user, dto),
        };
    }
}

@ApiTags('pas-verification')
@Controller('pas')
export class PasPublicVerificationController {
    constructor(private readonly administration: PasAdministrationService) {}

    @Get('verify/:code')
    @ApiOperation({ summary: 'Verifikasi publik keaslian dokumen Berita Acara atau Daftar Hadir' })
    async verifyDocument(@Param('code') code: string) {
        return this.administration.verifyDocumentByCode(code);
    }
}

