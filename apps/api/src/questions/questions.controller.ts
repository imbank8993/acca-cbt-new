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
import { CurrentSchoolId } from '../common/decorators/current-school-id.decorator';
import { BankContentService } from './bank-content.service';
import {
    CreateBankDto,
    CreateDimensionDto,
    CreateFolderDto,
    CreateInterpretationDto,
    CreateKisiKisiDto,
    CreateLabelDto,
    CreateTitledContentDto,
    DimensionDto,
    ImportRowsDto,
    InterpretationDto,
    MoveBanksDto,
    PublishBankDto,
    ReorderQuestionsDto,
    SaveBankDto,
    SaveFolderDto,
    SaveQuestionDto,
    TitledContentDto,
    UpdateKisiKisiDto,
    UpdateQuestionMetadataDto,
} from './dto/questions.dto';
import { QuestionBanksService } from './question-banks.service';
import { QuestionsService } from './questions.service';

/**
 * Bank soal beserta isinya.
 *
 * `@Roles` hanya saringan kasar "bukan siswa". Aturan sebenarnya ada di
 * `AuthorizationService.assertBankAccess`: Proktor/Admin bebas di organisasinya,
 * Guru hanya bank buatannya sendiri. Aturan itu bergantung pada kepemilikan
 * baris, bukan pada nama peran, jadi ia tidak bisa ditegakkan lewat dekorator.
 */
@ApiTags('question-banks')
@ApiBearerAuth()
@Controller('question-banks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'PROKTOR', 'GURU')
export class QuestionsController {
    constructor(
        private readonly banks: QuestionBanksService,
        private readonly questions: QuestionsService,
        private readonly content: BankContentService,
    ) {}

    // ── Bank soal ────────────────────────────────────────────────────────────

    @Get()
    @ApiOperation({ summary: 'Daftar bank soal satu organisasi' })
    async listBanks(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
        @Query('onlyPublished') onlyPublished?: string,
    ) {
        return {
            banks: await this.banks.list(user, organizationId, onlyPublished === 'true'),
        };
    }

    @Post()
    @ApiOperation({ summary: 'Buat bank soal baru' })
    createBank(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
        @Body() dto: CreateBankDto,
    ) {
        return this.banks.create(user, organizationId, dto);
    }

    // Segmen statis didaftarkan sebelum `:bankId` supaya "folders" dan "labels"
    // tidak terbaca sebagai id bank.

    @Get('folders')
    @ApiOperation({ summary: 'Folder bank soal satu organisasi' })
    async listFolders(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
    ) {
        return { folders: await this.banks.listFolders(user, organizationId) };
    }

    @Post('folders')
    @ApiOperation({ summary: 'Buat folder bank soal' })
    createFolder(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
        @Body() dto: CreateFolderDto,
    ) {
        return this.banks.createFolder(user, organizationId, dto.name, dto.clientRequestId);
    }

    @Patch('folders/:folderId')
    @ApiOperation({ summary: 'Ganti nama folder' })
    updateFolder(
        @CurrentUser() user: AuthUser,
        @Param('folderId', ParseUUIDPipe) folderId: string,
        @Body() dto: SaveFolderDto,
    ) {
        return this.banks.updateFolder(user, folderId, dto.name);
    }

    @Delete('folders/:folderId')
    @ApiOperation({
        summary: 'Hapus folder',
        description: 'Bank di dalamnya tidak ikut terhapus; keduanya kembali ke akar.',
    })
    removeFolder(
        @CurrentUser() user: AuthUser,
        @Param('folderId', ParseUUIDPipe) folderId: string,
    ) {
        return this.banks.removeFolder(user, folderId);
    }

    @Put('folders/move')
    @ApiOperation({ summary: 'Pindahkan satu atau beberapa bank ke sebuah folder' })
    moveBanks(@CurrentUser() user: AuthUser, @Body() dto: MoveBanksDto) {
        return this.banks.moveToFolder(user, dto.bankIds, dto.folderId ?? null);
    }

    @Get('labels')
    @ApiOperation({ summary: 'Label bank soal satu organisasi' })
    async listLabels(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
    ) {
        return { labels: await this.banks.listLabels(user, organizationId) };
    }

    @Post('labels')
    @ApiOperation({ summary: 'Buat label baru' })
    createLabel(
        @CurrentUser() user: AuthUser,
        @CurrentSchoolId() organizationId: string,
        @Body() dto: CreateLabelDto,
    ) {
        return this.banks.createLabel(
            user,
            organizationId,
            dto.name,
            dto.color || '',
            dto.clientRequestId,
        );
    }

    @Get(':bankId')
    @ApiOperation({ summary: 'Rincian satu bank soal' })
    async getBank(@CurrentUser() user: AuthUser, @Param('bankId', ParseUUIDPipe) bankId: string) {
        return { bank: await this.banks.get(user, bankId) };
    }

    @Patch(':bankId')
    @ApiOperation({ summary: 'Ubah bank soal' })
    updateBank(
        @CurrentUser() user: AuthUser,
        @Param('bankId', ParseUUIDPipe) bankId: string,
        @Body() dto: SaveBankDto,
    ) {
        return this.banks.update(user, bankId, dto);
    }

    @Delete(':bankId')
    @ApiOperation({ summary: 'Hapus bank soal beserta isinya' })
    removeBank(@CurrentUser() user: AuthUser, @Param('bankId', ParseUUIDPipe) bankId: string) {
        return this.banks.remove(user, bankId);
    }

    @Post(':bankId/publish')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Terbitkan atau tarik bank soal',
        description: 'Saat ditarik, ujian yang sedang berjalan memakai bank ini ikut dikembalikan.',
    })
    publishBank(
        @CurrentUser() user: AuthUser,
        @Param('bankId', ParseUUIDPipe) bankId: string,
        @Body() dto: PublishBankDto,
    ) {
        return this.banks.setPublished(user, bankId, dto.isPublished);
    }

    // ── Soal ─────────────────────────────────────────────────────────────────

    @Get(':bankId/questions')
    @ApiOperation({ summary: 'Seluruh soal sebuah bank, lengkap dengan kunci jawabannya' })
    async listQuestions(
        @CurrentUser() user: AuthUser,
        @Param('bankId', ParseUUIDPipe) bankId: string,
    ) {
        return { questions: await this.questions.listByBank(user, bankId) };
    }

    @Put('questions')
    @ApiOperation({ summary: 'Simpan satu soal beserta opsinya' })
    saveQuestion(@CurrentUser() user: AuthUser, @Body() dto: SaveQuestionDto) {
        return this.questions.save(user, dto);
    }

    @Patch('questions/:questionId/metadata')
    @ApiOperation({ summary: 'Tambal sebagian metadata soal' })
    updateQuestionMetadata(
        @CurrentUser() user: AuthUser,
        @Param('questionId', ParseUUIDPipe) questionId: string,
        @Body() dto: UpdateQuestionMetadataDto,
    ) {
        return this.questions.updateMetadata(user, questionId, dto.metadata);
    }

    @Delete(':bankId/questions/:questionId')
    @ApiOperation({
        summary: 'Hapus satu soal',
        description:
            'Soal yang sudah pernah dijawab disembunyikan, bukan dihapus. Balasannya memuat ' +
            'orphanedImages — berkas gambar yatim yang dihapus route handler Next.js.',
    })
    removeQuestion(
        @CurrentUser() user: AuthUser,
        @Param('bankId', ParseUUIDPipe) bankId: string,
        @Param('questionId', ParseUUIDPipe) questionId: string,
    ) {
        return this.questions.remove(user, questionId, bankId);
    }

    @Put(':bankId/questions/order')
    @ApiOperation({ summary: 'Simpan urutan soal' })
    reorderQuestions(
        @CurrentUser() user: AuthUser,
        @Param('bankId', ParseUUIDPipe) bankId: string,
        @Body() dto: ReorderQuestionsDto,
    ) {
        return this.questions.reorder(user, bankId, dto.orderedIds);
    }

    // ── Kisi-kisi ────────────────────────────────────────────────────────────

    @Get(':bankId/kisi-kisi')
    @ApiOperation({ summary: 'Kisi-kisi sebuah bank' })
    async listKisiKisi(
        @CurrentUser() user: AuthUser,
        @Param('bankId', ParseUUIDPipe) bankId: string,
    ) {
        return { items: await this.content.listKisiKisi(user, bankId) };
    }

    @Post(':bankId/kisi-kisi')
    @ApiOperation({ summary: 'Tambah kisi-kisi' })
    createKisiKisi(
        @CurrentUser() user: AuthUser,
        @Param('bankId', ParseUUIDPipe) bankId: string,
        @Body() dto: CreateKisiKisiDto,
    ) {
        const { clientRequestId, ...data } = dto;
        return this.content.createKisiKisi(user, bankId, data, clientRequestId);
    }

    @Patch('kisi-kisi/:id')
    @ApiOperation({ summary: 'Ubah kisi-kisi' })
    updateKisiKisi(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpdateKisiKisiDto,
    ) {
        return this.content.updateKisiKisi(user, id, { ...dto });
    }

    @Delete('kisi-kisi/:id')
    @ApiOperation({ summary: 'Hapus kisi-kisi' })
    removeKisiKisi(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
        return this.content.removeKisiKisi(user, id);
    }

    // ── Stimulus ─────────────────────────────────────────────────────────────

    @Get(':bankId/stimuli')
    @ApiOperation({ summary: 'Stimulus sebuah bank' })
    async listStimuli(
        @CurrentUser() user: AuthUser,
        @Param('bankId', ParseUUIDPipe) bankId: string,
    ) {
        return { items: await this.content.listStimuli(user, bankId) };
    }

    @Post(':bankId/stimuli')
    @ApiOperation({ summary: 'Tambah stimulus' })
    createStimulus(
        @CurrentUser() user: AuthUser,
        @Param('bankId', ParseUUIDPipe) bankId: string,
        @Body() dto: CreateTitledContentDto,
    ) {
        return this.content.createStimulus(
            user, bankId, dto.title || '', dto.content, dto.clientRequestId,
        );
    }

    @Post(':bankId/stimuli/import')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Impor stimulus dari baris berkas XLS' })
    importStimuli(
        @CurrentUser() user: AuthUser,
        @Param('bankId', ParseUUIDPipe) bankId: string,
        @Body() dto: ImportRowsDto,
    ) {
        return this.content.importStimuli(user, bankId, dto.rows, dto.clientRequestId);
    }

    @Patch('stimuli/:id')
    @ApiOperation({ summary: 'Ubah stimulus' })
    updateStimulus(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: TitledContentDto,
    ) {
        return this.content.updateStimulus(user, id, dto.title || '', dto.content);
    }

    @Delete('stimuli/:id')
    @ApiOperation({ summary: 'Hapus stimulus' })
    removeStimulus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
        return this.content.removeStimulus(user, id);
    }

    // ── Petunjuk ─────────────────────────────────────────────────────────────

    @Get(':bankId/instructions')
    @ApiOperation({ summary: 'Petunjuk pengerjaan sebuah bank' })
    async listInstructions(
        @CurrentUser() user: AuthUser,
        @Param('bankId', ParseUUIDPipe) bankId: string,
    ) {
        return { items: await this.content.listInstructions(user, bankId) };
    }

    @Post(':bankId/instructions')
    @ApiOperation({ summary: 'Tambah petunjuk' })
    createInstruction(
        @CurrentUser() user: AuthUser,
        @Param('bankId', ParseUUIDPipe) bankId: string,
        @Body() dto: CreateTitledContentDto,
    ) {
        return this.content.createInstruction(
            user, bankId, dto.title || '', dto.content, dto.clientRequestId,
        );
    }

    @Post(':bankId/instructions/import')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Impor petunjuk dari baris berkas XLS' })
    importInstructions(
        @CurrentUser() user: AuthUser,
        @Param('bankId', ParseUUIDPipe) bankId: string,
        @Body() dto: ImportRowsDto,
    ) {
        return this.content.importInstructions(user, bankId, dto.rows, dto.clientRequestId);
    }

    @Patch('instructions/:id')
    @ApiOperation({ summary: 'Ubah petunjuk' })
    updateInstruction(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: TitledContentDto,
    ) {
        return this.content.updateInstruction(user, id, dto.title || '', dto.content);
    }

    @Delete('instructions/:id')
    @ApiOperation({ summary: 'Hapus petunjuk' })
    removeInstruction(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
        return this.content.removeInstruction(user, id);
    }

    // ── Dimensi ──────────────────────────────────────────────────────────────

    @Get(':bankId/dimensions')
    @ApiOperation({ summary: 'Dimensi psikometri sebuah bank' })
    async listDimensions(
        @CurrentUser() user: AuthUser,
        @Param('bankId', ParseUUIDPipe) bankId: string,
    ) {
        return { items: await this.content.listDimensions(user, bankId) };
    }

    @Post(':bankId/dimensions')
    @ApiOperation({ summary: 'Tambah dimensi' })
    createDimension(
        @CurrentUser() user: AuthUser,
        @Param('bankId', ParseUUIDPipe) bankId: string,
        @Body() dto: CreateDimensionDto,
    ) {
        return this.content.createDimension(
            user, bankId, dto.name, dto.description || '', dto.clientRequestId,
        );
    }

    @Patch('dimensions/:id')
    @ApiOperation({ summary: 'Ubah dimensi' })
    updateDimension(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: DimensionDto,
    ) {
        return this.content.updateDimension(user, id, dto.name, dto.description || '');
    }

    @Delete('dimensions/:id')
    @ApiOperation({ summary: 'Hapus dimensi' })
    removeDimension(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
        return this.content.removeDimension(user, id);
    }

    // ── Tafsiran dimensi ─────────────────────────────────────────────────────

    @Get(':bankId/interpretations')
    @ApiOperation({ summary: 'Tafsiran seluruh dimensi sebuah bank' })
    async listInterpretations(
        @CurrentUser() user: AuthUser,
        @Param('bankId', ParseUUIDPipe) bankId: string,
    ) {
        return { items: await this.content.listInterpretations(user, bankId) };
    }

    @Post('interpretations')
    @ApiOperation({ summary: 'Tambah tafsiran dimensi' })
    createInterpretation(@CurrentUser() user: AuthUser, @Body() dto: CreateInterpretationDto) {
        const { dimensionId, clientRequestId, ...rest } = dto;
        return this.content.createInterpretation(user, dimensionId, rest, clientRequestId);
    }

    @Patch('interpretations/:id')
    @ApiOperation({ summary: 'Ubah tafsiran dimensi' })
    updateInterpretation(
        @CurrentUser() user: AuthUser,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: InterpretationDto,
    ) {
        return this.content.updateInterpretation(user, id, dto);
    }

    @Delete('interpretations/:id')
    @ApiOperation({ summary: 'Hapus tafsiran dimensi' })
    removeInterpretation(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
        return this.content.removeInterpretation(user, id);
    }
}
