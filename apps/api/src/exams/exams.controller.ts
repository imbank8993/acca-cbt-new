import { Controller, Delete, HttpCode, HttpStatus, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@acca-cbt/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ExamsService } from './exams.service';

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
}
