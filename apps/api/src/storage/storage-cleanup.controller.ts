import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { AuthUser } from '@acca-cbt/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MAX_CLEANUP_KEYS, MIN_ALLOWED_AGE_DAYS, UnusedImagesService } from './unused-images.service';

class UnusedImagesPreviewDto {
    @ApiPropertyOptional({ description: 'Gambar yang lebih muda dari ini (hari) tidak dihapus. Bawaan 30.' })
    @IsOptional() @IsInt() @Min(MIN_ALLOWED_AGE_DAYS) @Max(3650)
    minAgeDays?: number;
}

class UnusedImagesCleanupDto extends UnusedImagesPreviewDto {
    @ApiProperty({ description: 'Kunci berkas dari hasil pratinjau. Diperiksa ulang sebelum dihapus.', type: [String] })
    @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_CLEANUP_KEYS) @IsString({ each: true })
    keys!: string[];
}

/**
 * "Bersihkan gambar tak terpakai" — hanya Admin (dan superadmin/admin platform).
 * Penyimpanannya dipakai bersama seluruh sekolah di instalasi ini.
 */
@ApiTags('storage')
@ApiBearerAuth()
@Controller('storage/cleanup')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class StorageCleanupController {
    constructor(private readonly images: UnusedImagesService) {}

    @Post('unused-images/preview')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Pindai gambar soal yang tidak dipakai di mana pun (tanpa menghapus)' })
    preview(@Body() body: UnusedImagesPreviewDto) {
        return this.images.preview(body?.minAgeDays);
    }

    @Post('unused-images/delete')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Hapus gambar hasil pratinjau yang setelah dipindai ulang masih tidak dipakai' })
    cleanup(@CurrentUser() user: AuthUser, @Body() body: UnusedImagesCleanupDto) {
        return this.images.cleanup(user.id, body.keys, body.minAgeDays);
    }
}
