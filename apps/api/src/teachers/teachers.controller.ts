import {
    BadRequestException,
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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AddStudentDto, CreateClassDto, SubmitGradesDto } from './dto/teachers.dto';
import { TeachersService } from './teachers.service';

@ApiTags('teachers')
@ApiBearerAuth()
@Controller('teachers')
@UseGuards(JwtAuthGuard)
export class TeachersController {
    constructor(private readonly teachers: TeachersService) {}

    @Get('organization')
    @ApiOperation({ summary: 'Organisasi tempat pemanggil terdaftar' })
    async organization(@CurrentUser() user: AuthUser) {
        return { organization: await this.teachers.organization(user) };
    }

    @Get('classes')
    @ApiOperation({ summary: 'Kelas tambahan buatan pemanggil' })
    async listClasses(
        @CurrentUser() user: AuthUser,
        @Query('organizationId', ParseUUIDPipe) organizationId: string,
    ) {
        return { classes: await this.teachers.listClasses(user, organizationId) };
    }

    @Post('classes')
    @ApiOperation({ summary: 'Buat kelas tambahan' })
    async createClass(@CurrentUser() user: AuthUser, @Body() dto: CreateClassDto) {
        return { data: await this.teachers.createClass(user, dto.organizationId, dto.name) };
    }

    @Delete('classes/:id')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Hapus kelas tambahan' })
    async removeClass(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
    ) {
        await this.teachers.removeClass(user, id);
        return { id };
    }

    @Post('classes/:id/students')
    @ApiOperation({ summary: 'Tambahkan siswa ke kelas tambahan' })
    async addStudent(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: AddStudentDto,
    ) {
        await this.teachers.addStudentToClass(user, id, dto.studentId);
        return { classId: id, studentId: dto.studentId };
    }

    @Get('students')
    @ApiOperation({ summary: 'Daftar siswa satu organisasi' })
    async listStudents(
        @CurrentUser() user: AuthUser,
        @Query('organizationId', ParseUUIDPipe) organizationId: string,
    ) {
        return { students: await this.teachers.listStudents(user, organizationId) };
    }

    @Get('grading/:attemptId')
    @ApiOperation({ summary: 'Jawaban esai satu pengerjaan untuk dinilai' })
    async gradingDetails(
        @CurrentUser() user: AuthUser,
        @Param('attemptId', ParseUUIDPipe) attemptId: string,
    ) {
        return this.teachers.gradingDetails(user, attemptId);
    }

    @Put('grading/:attemptId')
    @ApiOperation({ summary: 'Simpan nilai esai dan hitung ulang total skor' })
    async submitGrades(
        @CurrentUser() user: AuthUser,
        @Param('attemptId', ParseUUIDPipe) attemptId: string,
        @Body() dto: SubmitGradesDto,
    ) {
        // Kunci objeknya dinamis (id jawaban), jadi bentuk nilainya diperiksa
        // di sini — class-validator tidak bisa menjangkaunya lewat dekorator.
        for (const [answerId, score] of Object.entries(dto.grades)) {
            if (typeof score !== 'number' || Number.isNaN(score) || score < 0) {
                throw new BadRequestException(`Nilai untuk jawaban ${answerId} tidak valid.`);
            }
        }
        return this.teachers.submitEssayGrades(user, attemptId, dto.grades);
    }

    @Get('stats')
    @ApiOperation({ summary: 'Statistik ringkas dasbor guru' })
    async stats(
        @CurrentUser() user: AuthUser,
        @Query('organizationId', ParseUUIDPipe) organizationId: string,
    ) {
        return { stats: await this.teachers.stats(user, organizationId) };
    }
}
