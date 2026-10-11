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
import { AuthorizationService } from '../auth/authorization.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LoginHistoryService } from '../auth/login-history.service';
import { SettingsService } from '../settings/settings.service';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentSchoolId } from '../common/decorators/current-school-id.decorator';
import { ClassesService } from './classes.service';
import {
    AssignExamDto,
    ClassIdsDto,
    CreateClassDto,
    CreateExamDto,
    CreateSchoolYearDto,
    ExamIdsDto,
    GradeAssignmentDto,
    ImportClassesDto,
    PublishExamDto,
    RecentLoginsQueryDto,
    UpdateClassDto,
    UpdateExamDto,
} from './dto/proctor.dto';
import { ExamAdminService } from './exam-admin.service';
import { ExamMonitoringService } from './exam-monitoring.service';
import { ProctorService } from './proctor.service';

/**
 * Dasbor staf sekolah: organisasi, kelas, ujian, dan pemantauannya.
 *
 * `@Roles` hanya saringan kasar "bukan siswa". Pembedaan Proktor/Admin dari
 * Guru — dan aturan kepemilikan yang membatasi Guru pada ujian serta kelas
 * buatannya sendiri — ada di service, karena aturannya bergantung pada baris
 * datanya, bukan pada nama peran.
 */
@ApiTags('proctor')
@ApiBearerAuth()
@Controller('proctor')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'PROKTOR', 'GURU', 'PENGAWAS')
export class ProctorController {
    constructor(
        private readonly proctor: ProctorService,
        private readonly classes: ClassesService,
        private readonly exams: ExamAdminService,
        private readonly monitoring: ExamMonitoringService,
        private readonly loginHistory: LoginHistoryService,
        private readonly authz: AuthorizationService,
        private readonly settings: SettingsService,
    ) {}

    // ── Organisasi & identitas ───────────────────────────────────────────────

    @Get('stats')
    @ApiOperation({ summary: 'Angka ringkas untuk kartu dasbor' })
    async getStats(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
    ) {
        return { stats: await this.proctor.getStats(user, organizationId) };
    }

    @Get('roles')
    @ApiOperation({
        summary: 'Peran pemanggil',
        description:
            'Tidak menerima userId: peran diambil dari token, bukan dari id kiriman browser.',
    })
    getRoles(@CurrentUser() user: AuthUser) {
        return this.proctor.resolveRoles(user);
    }

    @Get('recent-logins')
    @ApiOperation({ summary: 'Anggota organisasi, terurut menurut waktu masuk terakhir' })
    async getRecentLogins(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
        @Query() query: RecentLoginsQueryDto,
    ) {
        return {
            logins: await this.proctor.getRecentLogins(user, organizationId, query.limit ?? 10),
        };
    }

    @Get('top-scorers')
    @ApiOperation({ summary: 'Tiga peraih nilai tertinggi per ujian (ringkasan dasbor)' })
    async getTopScorers(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
        @Query() query: RecentLoginsQueryDto,
    ) {
        return {
            exams: await this.proctor.getTopScorers(user, organizationId, {
                examLimit: Math.min(query.limit ?? 6, 50),
                perExam: 3,
            }),
        };
    }

    @Get('login-history')
    @ApiOperation({ summary: 'Riwayat login detail seluruh anggota organisasi (khusus Proktor/Admin)' })
    async getLoginHistory(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
        @Query() query: RecentLoginsQueryDto,
    ) {
        // Memuat IP & perangkat seluruh anggota — jangan buka untuk Guru/Pengawas.
        await this.authz.assertProktor(user, organizationId);
        const timeZone = await this.settings.getSchoolTimeZone();
        const [history, stats] = await Promise.all([
            this.loginHistory.getRecent(organizationId, query.limit ?? 20),
            this.loginHistory.getStats(organizationId, timeZone),
        ]);
        return { history, stats };
    }

    // ── Tahun ajaran & mata pelajaran ────────────────────────────────────────

    @Get('school-years')
    @ApiOperation({ summary: 'Tahun ajaran terdaftar' })
    async listSchoolYears(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
    ) {
        return { schoolYears: await this.proctor.listSchoolYears(user, organizationId) };
    }

    @Get('school-years/active')
    @ApiOperation({ summary: 'Tahun ajaran yang sedang aktif' })
    async getActiveSchoolYear(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
    ) {
        return { schoolYear: await this.proctor.getActiveSchoolYear(user, organizationId) };
    }

    @Post('school-years')
    @ApiOperation({ summary: 'Tambah tahun ajaran' })
    createSchoolYear(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
        @Body() dto: CreateSchoolYearDto,
    ) {
        return this.proctor.createSchoolYear(user, organizationId, dto);
    }

    @Get('class-school-years')
    @ApiOperation({ summary: 'Tahun ajaran yang benar-benar dipakai kelas' })
    async listClassSchoolYears(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
    ) {
        return { years: await this.proctor.listClassSchoolYears(user, organizationId) };
    }

    @Get('subjects')
    @ApiOperation({ summary: 'Mata pelajaran dari master data acca-app' })
    async listSubjects(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
    ) {
        return { subjects: await this.proctor.listSubjects(user, organizationId) };
    }

    // ── Kelas ────────────────────────────────────────────────────────────────

    @Get('classes')
    @ApiOperation({
        summary: 'Kelas reguler dan tambahan',
        description: 'Menyinkronkan kelas dari master data acca-app lebih dulu.',
    })
    async listClasses(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
        @Query('activeYearOnly') activeYearOnly?: string,
    ) {
        return {
            classes: await this.classes.list(user, organizationId, activeYearOnly === 'true'),
        };
    }

    @Post('classes')
    @ApiOperation({ summary: 'Buat kelas baru' })
    createClass(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
        @Body() dto: CreateClassDto,
    ) {
        return this.classes.create(user, organizationId, dto);
    }

    @Post('classes/import')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Impor banyak kelas sekaligus' })
    importClasses(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
        @Body() dto: ImportClassesDto,
    ) {
        return this.classes.importMany(user, organizationId, dto.classes, dto.clientRequestId);
    }

    @Post('classes/members')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Siswa untuk sekumpulan kelas',
        description: 'POST karena daftar idnya bisa panjang; tidak mengubah apa pun.',
    })
    async listClassMembers(@CurrentUser() user: AuthUser, @Body() dto: ClassIdsDto) {
        return { members: await this.classes.listMembers(user, dto.classIds) };
    }

    @Get('classes/:classId/students')
    @ApiOperation({ summary: 'Siswa satu kelas' })
    async listStudents(
        @CurrentUser() user: AuthUser,
        @Param('classId', ParseUUIDPipe) classId: string,
        @Query('additional') additional?: string,
    ) {
        return {
            students: await this.classes.listStudents(user, classId, additional === 'true'),
        };
    }

    @Patch('classes/:classId')
    @ApiOperation({ summary: 'Ubah kelas' })
    updateClass(
        @CurrentUser() user: AuthUser,
        @Param('classId', ParseUUIDPipe) classId: string,
        @Body() dto: UpdateClassDto,
    ) {
        return this.classes.update(user, classId, dto);
    }

    @Delete('classes/:classId')
    @ApiOperation({ summary: 'Hapus kelas' })
    removeClass(
        @CurrentUser() user: AuthUser,
        @Param('classId', ParseUUIDPipe) classId: string,
    ) {
        return this.classes.remove(user, classId);
    }

    // ── Ujian ────────────────────────────────────────────────────────────────

    @Get('exams')
    @ApiOperation({ summary: 'Daftar ujian satu organisasi' })
    async listExams(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
    ) {
        return { exams: await this.exams.list(user, organizationId) };
    }

    @Post('exams')
    @ApiOperation({ summary: 'Buat ujian baru (berstatus draf)' })
    createExam(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
        @Body() dto: CreateExamDto,
    ) {
        return this.exams.create(user, organizationId, dto);
    }

    @Post('exams/assignments')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Penugasan sekumpulan ujian',
        description: 'POST karena daftar idnya bisa panjang; tidak mengubah apa pun.',
    })
    listExamAssignments(@CurrentUser() user: AuthUser, @Body() dto: ExamIdsDto) {
        return this.exams.listAssignments(user, dto.examIds);
    }

    @Patch('exams/:examId')
    @ApiOperation({ summary: 'Ubah ujian' })
    updateExam(
        @CurrentUser() user: AuthUser,
        @Param('examId', ParseUUIDPipe) examId: string,
        @Body() dto: UpdateExamDto,
    ) {
        return this.exams.update(user, examId, dto);
    }

    @Post('exams/:examId/publish')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Terbitkan atau tarik ujian' })
    publishExam(
        @CurrentUser() user: AuthUser,
        @Param('examId', ParseUUIDPipe) examId: string,
        @Body() dto: PublishExamDto,
    ) {
        return this.exams.setPublished(user, examId, dto.publish);
    }

    @Put('exams/:examId/assignments')
    @ApiOperation({ summary: 'Ganti seluruh penugasan sebuah ujian' })
    assignExam(
        @CurrentUser() user: AuthUser,
        @Param('examId', ParseUUIDPipe) examId: string,
        @Body() dto: AssignExamDto,
    ) {
        return this.exams.assign(
            user,
            examId,
            dto.classIds,
            dto.participantAssignments,
            dto.activate ?? true,
        );
    }

    // ── Pemantauan & hasil ───────────────────────────────────────────────────

    @Get('exams/:examId/attempts')
    @ApiOperation({
        summary: 'Pengerjaan sebuah ujian, termasuk siswa yang belum memulai',
        description: 'Menutup pengerjaan yang tenggatnya sudah lewat lebih dulu.',
    })
    async listAttempts(
        @CurrentUser() user: AuthUser,
        @Param('examId', ParseUUIDPipe) examId: string,
    ) {
        return { attempts: await this.monitoring.listAttempts(user, examId) };
    }

    @Get('exams/:examId/violations')
    @ApiOperation({
        summary: 'Pelanggaran terbaru sebuah ujian',
        description:
            'Dibaca dari log keamanan di basis data, jadi umpannya tetap terisi setelah ' +
            'halaman pemantauan dimuat ulang.',
    })
    async listViolations(
        @CurrentUser() user: AuthUser,
        @Param('examId', ParseUUIDPipe) examId: string,
        @Query() query: RecentLoginsQueryDto,
    ) {
        return {
            violations: await this.monitoring.listRecentViolations(
                user,
                examId,
                query.limit ?? 20,
            ),
        };
    }

    @Get('exams/:examId/item-analysis')
    @ApiOperation({
        summary: 'Data analisis butir soal',
        description:
            'Memuat kunci jawaban, jadi aksesnya dibatasi staf pemilik ujian. Jawaban yang ' +
            'belum dinilai dihitung saat itu juga agar angkanya tetap benar saat ujian berjalan.',
    })
    getItemAnalysis(
        @CurrentUser() user: AuthUser,
        @Param('examId', ParseUUIDPipe) examId: string,
    ) {
        return this.monitoring.getItemAnalysis(user, examId);
    }

    @Get('exams/:examId/submissions')
    @ApiOperation({ summary: 'Status pengumpulan tugas seluruh peserta' })
    listSubmissions(
        @CurrentUser() user: AuthUser,
        @Param('examId', ParseUUIDPipe) examId: string,
    ) {
        return this.monitoring.listAssignmentSubmissions(user, examId);
    }

    @Get('attempts/:attemptId')
    @ApiOperation({ summary: 'Rincian lengkap satu pengerjaan beserta log keamanannya' })
    getAttemptDetails(
        @CurrentUser() user: AuthUser,
        @Param('attemptId', ParseUUIDPipe) attemptId: string,
    ) {
        return this.monitoring.getAttemptDetails(user, attemptId);
    }

    @Post('attempts/:attemptId/grade')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Nilai satu pengumpulan tugas' })
    gradeAssignment(
        @CurrentUser() user: AuthUser,
        @Param('attemptId', ParseUUIDPipe) attemptId: string,
        @Body() dto: GradeAssignmentDto,
    ) {
        return this.monitoring.gradeAssignment(user, attemptId, dto.score, dto.feedback || '', dto.submittedAt);
    }
}
