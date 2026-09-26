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
    AddExamConfigBankDto,
    AddExamConfigExamDto,
    CreateExamConfigDto,
    GenerateExamsDto,
    LockExamConfigDto,
    UpdateExamConfigBankDto,
    UpdateExamConfigDto,
} from './dto/exam-configs.dto';
import { ExamConfigsService } from './exam-configs.service';

/**
 * Konfigurasi ujian massal ("ujian folder") untuk PAS/PAT.
 *
 * `@Roles` di sini hanya saringan kasar "bukan siswa". Pembedaan baca (staf) dan
 * tulis (Proktor/Admin) ada di service, yang juga memeriksa organisasinya —
 * seorang Guru dari sekolah lain lolos `@Roles` tetapi ditolak di sana.
 */
@ApiTags('exam-configs')
@ApiBearerAuth()
@Controller('exam-configs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'PROKTOR', 'GURU')
export class ExamConfigsController {
    constructor(private readonly configs: ExamConfigsService) {}

    @Get()
    @ApiOperation({ summary: 'Daftar konfigurasi ujian satu organisasi' })
    async list(@CurrentUser() user: AuthUser, @CurrentSchoolId() organizationId: string) {
        return { configs: await this.configs.list(user, organizationId) };
    }

    @Get(':id')
    @ApiOperation({ summary: 'Satu konfigurasi beserta bank soal dan jadwal kelasnya' })
    async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
        return { config: await this.configs.get(user, id) };
    }

    @Post()
    @ApiOperation({ summary: 'Buat konfigurasi ujian baru' })
    create(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
        @Body() dto: CreateExamConfigDto,
    ) {
        return this.configs.create(user, organizationId, dto);
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Ubah konfigurasi ujian' })
    update(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpdateExamConfigDto,
    ) {
        return this.configs.update(user, id, dto);
    }

    @Post(':id/lock')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Kunci atau buka kunci konfigurasi ujian' })
    lock(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: LockExamConfigDto,
    ) {
        return this.configs.setLock(user, id, dto.lock);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Hapus konfigurasi ujian beserta ujian hasil bangkitannya' })
    remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
        return this.configs.remove(user, id);
    }

    // ── Bank soal ────────────────────────────────────────────────────────────

    @Post('banks')
    @ApiOperation({ summary: 'Tambahkan bank soal ke konfigurasi' })
    addBank(@CurrentUser() user: AuthUser, @Body() dto: AddExamConfigBankDto) {
        return this.configs.addBank(user, dto);
    }

    @Patch('banks/:bankRowId')
    @ApiOperation({ summary: 'Ubah durasi atau mata pelajaran satu bank soal' })
    updateBank(
        @CurrentUser() user: AuthUser,
        @Param('bankRowId', ParseUUIDPipe) bankRowId: string,
        @Body() dto: UpdateExamConfigBankDto,
    ) {
        return this.configs.updateBank(user, bankRowId, dto);
    }

    @Delete('banks/:bankRowId')
    @ApiOperation({ summary: 'Keluarkan bank soal dari konfigurasi' })
    removeBank(
        @CurrentUser() user: AuthUser,
        @Param('bankRowId', ParseUUIDPipe) bankRowId: string,
    ) {
        return this.configs.removeBank(user, bankRowId);
    }

    // ── Jadwal kelas ─────────────────────────────────────────────────────────

    @Post('schedules')
    @ApiOperation({ summary: 'Jadwalkan satu bank soal untuk satu kelas' })
    addSchedule(@CurrentUser() user: AuthUser, @Body() dto: AddExamConfigExamDto) {
        return this.configs.addSchedule(user, dto);
    }

    @Delete('schedules/:scheduleId')
    @ApiOperation({ summary: 'Hapus jadwal kelas beserta ujian hasil bangkitannya' })
    removeSchedule(
        @CurrentUser() user: AuthUser,
        @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    ) {
        return this.configs.removeSchedule(user, scheduleId);
    }

    @Post('generate')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Bangkitkan ujian sungguhan dari jadwal yang dipilih' })
    generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateExamsDto) {
        return this.configs.generate(user, dto.configExamIds);
    }
}
