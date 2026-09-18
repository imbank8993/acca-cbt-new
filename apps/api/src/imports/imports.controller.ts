import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@acca-cbt/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BulkImportDto } from './dto/bulk-import.dto';
import { ImportsService } from './imports.service';

@ApiTags('imports')
@ApiBearerAuth()
@Controller('question-banks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'PROKTOR', 'GURU')
export class ImportsController {
    constructor(private readonly imports: ImportsService) {}

    @Get(':bankId/import-permission')
    @ApiOperation({
        summary: 'Periksa apakah pemanggil boleh mengimpor ke bank soal ini',
        description:
            'Dipanggil route handler Next.js SEBELUM ia merender persamaan dan mengunggah SVG ' +
            'ke R2. Tanpa pemeriksaan ini, siapa pun yang punya sesi — termasuk siswa — bisa ' +
            'memicu unggahan berkas untuk bank soal mana pun, karena penolakannya baru terjadi ' +
            'setelah berkasnya terlanjur ditulis. Aturannya tetap hanya ada di sini, tidak ' +
            'disalin ke apps/web.',
    })
    async importPermission(
        @CurrentUser() user: AuthUser,
        @Param('bankId', ParseUUIDPipe) bankId: string,
    ) {
        await this.imports.assertCanImport(user, bankId);
        return { allowed: true };
    }

    @Post(':bankId/bulk-import')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Impor massal soal ke satu bank',
        description:
            'Teks soal harus sudah bebas MathML: perenderan persamaan dan unggahannya ke R2 ' +
            'dikerjakan route handler Next.js sebelum memanggil endpoint ini.',
    })
    bulkImport(
        @CurrentUser() user: AuthUser,
        @Param('bankId', ParseUUIDPipe) bankId: string,
        @Body() dto: BulkImportDto,
    ) {
        return this.imports.bulkImport(user, bankId, dto.questions);
    }
}
