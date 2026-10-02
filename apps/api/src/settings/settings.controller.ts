import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    NotFoundException,
    Param,
    Put,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@acca-cbt/shared';
import { AllowInternalKey } from '../auth/allow-internal-key.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpsertSettingDto } from './dto/upsert-setting.dto';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
    constructor(private readonly settings: SettingsService) {}

    @Get()
    @AllowInternalKey()
    @ApiOperation({ summary: 'Pengaturan aplikasi (tanpa key sensitif)' })
    async findAll() {
        // Dibaca setiap pengguna yang sudah masuk — sidebar mengambil nama
        // aplikasi dari sini — dan juga oleh root layout lewat kunci internal
        // saat belum ada pengguna yang dikenali.
        //
        // Karena itu key sensitif SELALU disaring di sini. `storage_config`
        // memuat kredensial R2; versi lama mengirimkannya ke browser setiap
        // pengguna termasuk siswa.
        return { settings: await this.settings.findAll() };
    }

    @Get('school-timezone')
    @AllowInternalKey()
    @ApiOperation({ summary: 'Informasi zona waktu sekolah dan sumber sinkronisasi' })
    async getSchoolTimeZoneInfo() {
        return this.settings.getSchoolTimeZoneInfo();
    }

    @Get(':key')
    @ApiOperation({ summary: 'Satu pengaturan berdasarkan key' })
    async findOne(@CurrentUser() user: AuthUser, @Param('key') key: string) {
        if (SettingsService.isSensitive(key)) {
            const elevated =
                user.isPlatformAdmin ||
                user.resolved?.superadmin === true ||
                user.roles.some((r) => r === 'ADMIN' || r === 'PROKTOR');
            if (!elevated) {
                throw new ForbiddenException(
                    'Pengaturan ini hanya dapat dibaca Admin atau Proktor.',
                );
            }
        }

        const setting = await this.settings.findOne(key);
        if (!setting) throw new NotFoundException(`Pengaturan '${key}' tidak ditemukan.`);
        return { setting };
    }

    @Put()
    @UseGuards(RolesGuard)
    @Roles('ADMIN', 'PROKTOR')
    @ApiOperation({ summary: 'Simpan satu pengaturan' })
    async upsert(@Body() dto: UpsertSettingDto) {
        await this.settings.upsert(dto.key, dto.value);
        return { key: dto.key };
    }
}
