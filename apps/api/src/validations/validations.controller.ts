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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
    CreateValidationDto,
    DecideValidationDto,
    ResolveNoteDto,
    SaveValidationNoteDto,
    SetItemStatusDto,
    SubmitValidationDto,
    UpdateValidationDto,
    UpdateValidationNoteDto,
    VerifyNoteDto,
    SaveValidationFolderDto,
} from './dto/validations.dto';
import { ValidationsService } from './validations.service';

@ApiTags('validations')
@ApiBearerAuth()
@Controller('validations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'PROKTOR', 'GURU')
export class ValidationsController {
    constructor(private readonly validations: ValidationsService) {}

    @Get('folders')
    @Roles('ADMIN', 'PROKTOR')
    listFolders(@CurrentUser() user: AuthUser) {
        return this.validations.listFolders(user);
    }

    @Post('folders')
    @Roles('ADMIN', 'PROKTOR')
    createFolder(@CurrentUser() user: AuthUser, @Body() dto: SaveValidationFolderDto) {
        return this.validations.createFolder(user, dto.name);
    }

    @Patch('folders/:folderId')
    @Roles('ADMIN', 'PROKTOR')
    updateFolder(@CurrentUser() user: AuthUser, @Param('folderId', ParseUUIDPipe) folderId: string, @Body() dto: SaveValidationFolderDto) {
        return this.validations.updateFolder(user, folderId, dto.name);
    }

    @Delete('folders/:folderId')
    @Roles('ADMIN', 'PROKTOR')
    removeFolder(@CurrentUser() user: AuthUser, @Param('folderId', ParseUUIDPipe) folderId: string) {
        return this.validations.removeFolder(user, folderId);
    }

    @Post()
    @Roles('ADMIN', 'PROKTOR')
    @ApiOperation({ summary: 'Admin/Proktor membuat sesi penugasan validasi bank soal' })
    create(@CurrentUser() user: AuthUser, @Body() dto: CreateValidationDto) {
        return this.validations.create(user, dto);
    }

    @Get()
    @Roles('ADMIN', 'PROKTOR')
    @ApiOperation({ summary: 'Daftar penugasan validasi sekolah (Admin & Proktor)' })
    list(@CurrentUser() user: AuthUser, @Query('bankId') bankId?: string) {
        return this.validations.list(user, bankId);
    }

    @Get('my-tasks')
    @ApiOperation({ summary: 'Daftar tugas validasi yang ditugaskan kepada guru ini' })
    listMyTasks(@CurrentUser() user: AuthUser) {
        return this.validations.listMyAssignedTasks(user);
    }

    @Get('bank/:bankId/feedback')
    @ApiOperation({ summary: 'Catatan & umpan balik validasi untuk bank soal (dilihat pembuat soal)' })
    getBankFeedback(
        @CurrentUser() user: AuthUser,
        @Param('bankId', ParseUUIDPipe) bankId: string,
    ) {
        return this.validations.getBankFeedback(user, bankId);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Detail status satu sesi penugasan validasi' })
    getDetail(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
    ) {
        return this.validations.getDetail(user, id);
    }

    @Patch(':id')
    @Roles('ADMIN', 'PROKTOR')
    @ApiOperation({ summary: 'Ubah judul, instruksi, batas waktu, atau validator sesi' })
    updateSession(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpdateValidationDto,
    ) {
        return this.validations.updateSession(user, id, dto);
    }

    @Delete(':id')
    @Roles('ADMIN', 'PROKTOR')
    @ApiOperation({ summary: 'Hapus sesi validasi (pembuat sesi atau Admin)' })
    removeSession(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
    ) {
        return this.validations.removeSession(user, id);
    }

    @Post(':id/reopen')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Validator membuka kembali hasil yang sudah dikirim untuk diubah' })
    reopen(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
    ) {
        return this.validations.reopen(user, id);
    }

    @Post(':id/resubmit')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Pembuat soal mengajukan telaah ulang setelah memperbaiki catatan' })
    resubmit(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
    ) {
        return this.validations.resubmit(user, id);
    }

    @Put(':id/items/:questionId')
    @ApiOperation({ summary: 'Validator menetapkan kelayakan satu butir soal' })
    setItemStatus(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Param('questionId', ParseUUIDPipe) questionId: string,
        @Body() dto: SetItemStatusDto,
    ) {
        return this.validations.setItemStatus(user, id, questionId, dto.status);
    }

    @Patch(':id/notes/:noteId')
    @ApiOperation({ summary: 'Validator mengubah catatan miliknya' })
    updateNote(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Param('noteId', ParseUUIDPipe) noteId: string,
        @Body() dto: UpdateValidationNoteDto,
    ) {
        return this.validations.updateNote(user, id, noteId, dto);
    }

    @Patch(':id/notes/:noteId/verify')
    @ApiOperation({ summary: 'Validator menilai perbaikan atas catatannya (Diterima/Belum sesuai)' })
    verifyNote(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Param('noteId', ParseUUIDPipe) noteId: string,
        @Body() dto: VerifyNoteDto,
    ) {
        return this.validations.verifyNote(user, id, noteId, dto.verification);
    }

    @Get(':id/review')
    @ApiOperation({ summary: 'Data soal dan catatan untuk layar validasi validator' })
    getReviewData(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
    ) {
        return this.validations.getReviewData(user, id);
    }

    @Post(':id/notes')
    @ApiOperation({ summary: 'Simpan catatan/highlight validator pada nomor soal tertentu' })
    saveNote(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: SaveValidationNoteDto,
    ) {
        return this.validations.saveNote(user, id, dto);
    }

    @Delete(':id/notes/:noteId')
    @ApiOperation({ summary: 'Hapus catatan yang dibuat oleh validator' })
    deleteNote(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Param('noteId', ParseUUIDPipe) noteId: string,
    ) {
        return this.validations.deleteNote(user, id, noteId);
    }

    @Post(':id/submit')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Selesaikan validasi dan kirim kesimpulan umum validator' })
    submitReview(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: SubmitValidationDto,
    ) {
        return this.validations.submitReview(user, id, dto);
    }

    @Post(':id/decision')
    @Roles('ADMIN', 'PROKTOR')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Simpan keputusan akhir Admin/Proktor sebagai catatan validasi' })
    decide(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: DecideValidationDto,
    ) {
        return this.validations.decide(user, id, dto.status);
    }

    @Patch('notes/:noteId/resolve')
    @ApiOperation({ summary: 'Guru pembuat menandai catatan sudah diperbaiki (Resolve)' })
    resolveNote(
        @CurrentUser() user: AuthUser,
        @Param('noteId', ParseUUIDPipe) noteId: string,
        @Body() dto: ResolveNoteDto,
    ) {
        return this.validations.resolveNote(user, noteId, dto.resolved, dto.response);
    }
}
