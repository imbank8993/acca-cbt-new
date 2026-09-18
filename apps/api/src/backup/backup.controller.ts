import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsObject, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { AuthUser } from '@acca-cbt/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BackupService, type BackupPayload } from './backup.service';

class ImportBackupDto {
    @ApiProperty()
    @IsUUID('4', { message: 'organizationId tidak valid' })
    organizationId!: string;

    @ApiProperty({
        description:
            'Isi berkas cadangan yang sudah dibuka route handler Next.js. Keutuhan berkasnya ' +
            'diperiksa di sana, tempat berkasnya memang dibaca; di sini yang menentukan boleh ' +
            'tidaknya memulihkan adalah peran pemanggil, bukan isi muatannya.',
    })
    @IsObject({ message: 'payload harus berupa objek' })
    payload!: BackupPayload;
}

/**
 * Cadangan data satu sekolah.
 *
 * Hanya bagian basis datanya yang ada di sini. Pembungkusan ZIP, pengunduhan dan
 * pengunggahan gambar, serta tanda tangan berkasnya tetap di route handler
 * Next.js — semuanya urusan berkas, dan NestJS tidak menyentuh penyimpanan.
 */
@ApiTags('backup')
@ApiBearerAuth()
@Controller('backup')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'PROKTOR')
export class BackupController {
    constructor(private readonly backup: BackupService) {}

    @Get('export')
    @ApiOperation({ summary: 'Seluruh data satu organisasi, sebagai JSON' })
    export(
        @CurrentUser() user: AuthUser,
        @Query('organizationId') organizationId: string,
    ) {
        return this.backup.export(user, organizationId);
    }

    @Post('import')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Pulihkan cadangan, MENGGANTI seluruh data organisasi',
        description:
            'Data lama dihapus lebih dulu. Keanggotaan pemanggil sengaja dipertahankan supaya ' +
            'ia tidak kehilangan akses di tengah pemulihan.',
    })
    import(@CurrentUser() user: AuthUser, @Body() dto: ImportBackupDto) {
        return this.backup.import(user, dto.organizationId, dto.payload);
    }
}
