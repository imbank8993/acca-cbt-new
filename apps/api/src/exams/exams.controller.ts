import { Body, Controller, Delete, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@acca-cbt/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ExamsService } from './exams.service';
import { PurgeExamDto } from './dto/purge-exam.dto';

@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams')
@UseGuards(JwtAuthGuard)
export class ExamsController {
    constructor(private readonly exams: ExamsService) {}

    @Delete(':id')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Hapus ujian beserta seluruh data terkaitnya' })
    async remove(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
    ) {
        // Tanpa @Roles di sini: aturannya bergantung pada jenis ujian dan
        // kepemilikannya, bukan sekadar nama peran. AuthorizationService yang
        // menegakkannya — lihat assertExamStaff.
        await this.exams.remove(user, id);
        return { id };
    }

    @Post(':id/purge-trial')
    @HttpCode(HttpStatus.OK)
    @UseGuards(RolesGuard)
    @Roles('ADMIN', 'PROKTOR')
    @ApiOperation({ summary: 'Hapus permanen ujian uji coba yang sudah tidak dipublikasikan' })
    purgeTrial(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: PurgeExamDto,
    ) {
        return this.exams.purgeTrial(user, id, dto.confirmationTitle);
    }
}
