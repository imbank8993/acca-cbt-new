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
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@acca-cbt/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
    JoinClassDto,
    SaveAnswerDto,
    StartAttemptDto,
    SubmitExamDto,
    SyncAnswersDto,
    SyncLateAnswersDto,
} from './dto/students.dto';
import { ExamAttemptsService } from './exam-attempts.service';
import { StudentsService } from './students.service';

/**
 * Semua yang dilakukan siswa atas dirinya sendiri.
 *
 * TIDAK ADA `@Roles` di sini, dan itu disengaja: setiap endpoint bekerja pada
 * data milik pemegang token — kelasnya sendiri, pengerjaannya sendiri, hasilnya
 * sendiri. Kepemilikan itulah otorisasinya, dan ia ditegakkan di service, bukan
 * lewat nama peran. Guru yang ikut mengerjakan ujian percobaan pun tetap sah di
 * sini, dan tidak satu pun endpoint bisa menyentuh data orang lain.
 */
@ApiTags('students')
@ApiBearerAuth()
@Controller('students')
@UseGuards(JwtAuthGuard)
export class StudentsController {
    constructor(
        private readonly students: StudentsService,
        private readonly attempts: ExamAttemptsService,
    ) {}

    // ── Kelas ────────────────────────────────────────────────────────────────

    @Get('classes')
    @ApiOperation({ summary: 'Kelas yang diikuti, reguler maupun tambahan' })
    async listClasses(@CurrentUser() user: AuthUser) {
        return { classes: await this.students.listClasses(user) };
    }

    @Post('classes/join')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Gabung ke kelas tambahan dengan kode undangan' })
    joinClass(@CurrentUser() user: AuthUser, @Body() dto: JoinClassDto) {
        return this.students.joinClass(user, dto.joinCode);
    }

    @Delete('classes/:classId')
    @ApiOperation({ summary: 'Keluar dari kelas tambahan' })
    leaveClass(@CurrentUser() user: AuthUser, @Param('classId', ParseUUIDPipe) classId: string) {
        return this.students.leaveClass(user, classId);
    }

    // ── Jadwal & hasil ───────────────────────────────────────────────────────

    @Get('exams')
    @ApiOperation({ summary: 'Ujian yang ditugaskan kepada siswa ini' })
    async listExams(@CurrentUser() user: AuthUser) {
        return { exams: await this.students.listExams(user) };
    }

    @Get('results')
    @ApiOperation({ summary: 'Riwayat nilai siswa ini' })
    async listResults(@CurrentUser() user: AuthUser) {
        return { results: await this.students.listResults(user) };
    }

    @Get('attempts/:attemptId')
    @ApiOperation({ summary: 'Rincian hasil satu pengerjaan, bila guru sudah membukanya' })
    getAttemptDetails(
        @CurrentUser() user: AuthUser,
        @Param('attemptId', ParseUUIDPipe) attemptId: string,
    ) {
        return this.students.getAttemptDetails(user, attemptId);
    }

    // ── Mengerjakan ──────────────────────────────────────────────────────────

    @Get('exams/:examId')
    @ApiOperation({
        summary: 'Keterangan ujian untuk layar pengerjaan, beserta identitas peserta',
    })
    getExamForAttempt(
        @CurrentUser() user: AuthUser,
        @Param('examId', ParseUUIDPipe) examId: string,
    ) {
        return this.students.getExamForAttempt(user, examId);
    }

    @Get('exams/:examId/questions')
    @ApiOperation({
        summary: 'Soal dan opsi untuk dikerjakan',
        description: 'Tanpa kunci jawaban: kolom is_correct tidak ikut diambil.',
    })
    getQuestions(@CurrentUser() user: AuthUser, @Param('examId', ParseUUIDPipe) examId: string) {
        return this.attempts.getQuestions(user, examId);
    }

    @Post('exams/:examId/attempts')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Mulai atau lanjutkan pengerjaan' })
    start(
        @CurrentUser() user: AuthUser,
        @Param('examId', ParseUUIDPipe) examId: string,
        @Body() dto: StartAttemptDto,
    ) {
        return this.attempts.start(user, examId, dto.deviceId);
    }

    @Put('attempts/:attemptId/answers/:questionId')
    @ApiOperation({ summary: 'Simpan satu jawaban (autosave)' })
    saveAnswer(
        @CurrentUser() user: AuthUser,
        @Param('attemptId', ParseUUIDPipe) attemptId: string,
        @Param('questionId', ParseUUIDPipe) questionId: string,
        @Body() dto: SaveAnswerDto,
    ) {
        return this.attempts.saveAnswer(user, attemptId, { questionId, ...dto }, dto.deviceId);
    }

    @Put('attempts/:attemptId/answers')
    @ApiOperation({ summary: 'Simpan banyak jawaban sekaligus' })
    syncAnswers(
        @CurrentUser() user: AuthUser,
        @Param('attemptId', ParseUUIDPipe) attemptId: string,
        @Body() dto: SyncAnswersDto,
    ) {
        return this.attempts.syncAnswers(user, attemptId, dto.answers, dto.deviceId);
    }

    @Post('attempts/:attemptId/late-answers')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Susulkan jawaban yang tertinggal di perangkat',
        description:
            'Hanya untuk pengerjaan yang ditutup otomatis sistem, dari perangkat yang sama, ' +
            'dalam enam jam sejak ditutup.',
    })
    syncLateAnswers(
        @CurrentUser() user: AuthUser,
        @Param('attemptId', ParseUUIDPipe) attemptId: string,
        @Body() dto: SyncLateAnswersDto,
    ) {
        return this.attempts.syncLateAnswers(user, attemptId, dto.answers, dto.deviceId);
    }

    @Post('exams/:examId/submit')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Kumpulkan ujian dan hitung nilainya' })
    submit(
        @CurrentUser() user: AuthUser,
        @Param('examId', ParseUUIDPipe) examId: string,
        @Body() dto: SubmitExamDto,
    ) {
        return this.attempts.submit(
            user,
            examId,
            dto.answers,
            dto.assignmentData,
            dto.attemptId,
            dto.deviceId,
        );
    }
}
