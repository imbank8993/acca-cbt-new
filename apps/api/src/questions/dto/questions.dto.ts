import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    ArrayNotEmpty,
    IsArray,
    IsBoolean,
    IsHexColor,
    IsIn,
    IsInt,
    IsNotEmpty,
    IsNumber,
    IsObject,
    IsOptional,
    IsString,
    IsUUID,
    Min,
    ValidateIf,
    ValidateNested,
} from 'class-validator';

export const QUESTION_TYPES = [
    'mcq',
    'mcq_complex',
    'true_false',
    'matching',
    'categorization',
    'short_answer',
    'essay',
    'sjt',
    'ordering',
    'likert',
    'forced_choice',
    'checklist',
    'ranking',
    'paired_comparison',
] as const;

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export class QuestionOptionDto {
    @ApiPropertyOptional({ description: 'Ada berarti opsi lama yang diubah; kosong berarti baru.' })
    @IsOptional()
    @IsUUID('4', { message: 'id opsi tidak valid' })
    id?: string;

    @ApiProperty()
    @IsString()
    text!: string;

    @ApiProperty()
    @IsBoolean()
    isCorrect!: boolean;

    @ApiProperty()
    @IsNumber()
    order!: number;

    @ApiPropertyOptional({ default: 1 })
    @IsOptional()
    @IsNumber()
    weight?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsObject()
    metadata?: Record<string, any>;
}

export class SaveQuestionDto {
    @ApiPropertyOptional({ description: 'Ada berarti menyunting soal lama; kosong berarti baru.' })
    @IsOptional()
    @IsUUID('4', { message: 'id soal tidak valid' })
    id?: string;

    @ApiPropertyOptional({ description: 'Wajib untuk soal baru; mencegah duplikasi saat retry.' })
    @ValidateIf((dto: SaveQuestionDto) => !dto.id)
    @IsUUID('4', { message: 'clientRequestId tidak valid' })
    clientRequestId?: string;

    @ApiPropertyOptional({ description: 'Wajib saat edit untuk mendeteksi perubahan dari tab lain.' })
    @ValidateIf((dto: SaveQuestionDto) => Boolean(dto.id))
    @IsInt({ message: 'expectedRevision tidak valid' })
    @Min(1, { message: 'expectedRevision tidak valid' })
    expectedRevision?: number;

    @ApiProperty()
    @IsUUID('4', { message: 'bankId tidak valid' })
    bankId!: string;

    @ApiProperty({ enum: QUESTION_TYPES })
    @IsIn(QUESTION_TYPES, { message: 'Tipe soal tidak dikenal' })
    type!: (typeof QUESTION_TYPES)[number];

    @ApiProperty()
    @IsString()
    @IsNotEmpty({ message: 'Teks soal wajib diisi.' })
    questionText!: string;

    @ApiProperty({ enum: DIFFICULTIES })
    @IsIn(DIFFICULTIES, { message: 'Tingkat kesulitan harus easy, medium, atau hard' })
    difficulty!: (typeof DIFFICULTIES)[number];

    @ApiProperty({ default: 1 })
    @IsNumber()
    scoreDefault!: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsObject()
    metadata?: Record<string, any>;

    @ApiPropertyOptional()
    @IsOptional()
    @IsUUID('4', { message: 'stimulusId tidak valid' })
    stimulusId?: string | null;

    @ApiPropertyOptional()
    @IsOptional()
    @IsUUID('4', { message: 'instructionId tidak valid' })
    instructionId?: string | null;

    @ApiPropertyOptional()
    @IsOptional()
    @IsUUID('4', { message: 'dimensionId tidak valid' })
    dimensionId?: string | null;

    @ApiPropertyOptional()
    @IsOptional()
    @IsUUID('4', { message: 'kisi_kisi_id tidak valid' })
    kisi_kisi_id?: string | null;

    @ApiPropertyOptional({ type: [QuestionOptionDto] })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => QuestionOptionDto)
    options?: QuestionOptionDto[];
}

export class UpdateQuestionMetadataDto {
    @ApiProperty({ description: 'Hanya kunci yang disebut yang ditimpa.' })
    @IsObject({ message: 'metadata harus berupa objek' })
    metadata!: Record<string, any>;
}

export class ReorderQuestionsDto {
    @ApiProperty({ type: [String], description: 'Id soal dalam urutan akhir yang diinginkan.' })
    @IsArray()
    @IsUUID('4', { each: true, message: 'orderedIds memuat id yang tidak valid' })
    orderedIds!: string[];
}

// ── Bank soal ────────────────────────────────────────────────────────────────

export class SaveBankDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    title?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    subject?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    classLevel?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    iconIdentifier?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    imageUrl?: string;

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tags?: string[];

    @ApiPropertyOptional({ description: 'null memindahkan bank keluar dari folder mana pun.' })
    @IsOptional()
    @IsString()
    folderId?: string | null;
}

export class CreateBankDto extends SaveBankDto {
    @ApiProperty({ description: 'UUID stabil untuk mencegah data ganda saat permintaan diulang.' })
    @IsUUID('4', { message: 'clientRequestId tidak valid' })
    clientRequestId!: string;
}

export class PublishBankDto {
    @ApiProperty()
    @IsBoolean()
    isPublished!: boolean;
}

export class MoveBanksDto {
    @ApiProperty({ type: [String] })
    @IsArray()
    @ArrayNotEmpty({ message: 'Pilih minimal satu bank soal.' })
    @IsUUID('4', { each: true, message: 'bankIds memuat id yang tidak valid' })
    bankIds!: string[];

    @ApiPropertyOptional({ description: 'null memindahkan bank ke akar.' })
    @IsOptional()
    @IsUUID('4', { message: 'folderId tidak valid' })
    folderId?: string | null;
}

export class SaveFolderDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty({ message: 'Nama folder wajib diisi.' })
    name!: string;
}

export class CreateFolderDto extends SaveFolderDto {
    @ApiProperty({ description: 'UUID stabil untuk mencegah data ganda saat permintaan diulang.' })
    @IsUUID('4', { message: 'clientRequestId tidak valid' })
    clientRequestId!: string;
}

export class CreateLabelDto {
    @ApiProperty({ description: 'UUID stabil untuk mencegah data ganda saat permintaan diulang.' })
    @IsUUID('4', { message: 'clientRequestId tidak valid' })
    clientRequestId!: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty({ message: 'Nama label wajib diisi.' })
    name!: string;

    @ApiPropertyOptional({ default: '#6366f1' })
    @IsOptional()
    @IsHexColor({ message: 'Warna harus berupa kode heks, mis. #6366f1' })
    color?: string;
}

// ── Isi pendamping bank ──────────────────────────────────────────────────────

export class KisiKisiDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty({ message: 'Nomor KD wajib diisi.' })
    nomor_kd!: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    kd_cp?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    materi?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    indikator_soal?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    level_kognitif?: string;
}

export class CreateKisiKisiDto extends KisiKisiDto {
    @ApiProperty({ description: 'UUID stabil untuk mencegah data ganda saat permintaan diulang.' })
    @IsUUID('4', { message: 'clientRequestId tidak valid' })
    clientRequestId!: string;
}

export class UpdateKisiKisiDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    nomor_kd?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    kd_cp?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    materi?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    indikator_soal?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    level_kognitif?: string;
}

export class TitledContentDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    title?: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty({ message: 'Konten wajib diisi.' })
    content!: string;
}

export class CreateTitledContentDto extends TitledContentDto {
    @ApiProperty({ description: 'UUID stabil untuk mencegah data ganda saat permintaan diulang.' })
    @IsUUID('4', { message: 'clientRequestId tidak valid' })
    clientRequestId!: string;
}

export class DimensionDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty({ message: 'Nama dimensi wajib diisi.' })
    name!: string;

    @ApiPropertyOptional({ default: '' })
    @IsOptional()
    @IsString()
    description?: string;
}

export class CreateDimensionDto extends DimensionDto {
    @ApiProperty({ description: 'UUID stabil untuk mencegah data ganda saat permintaan diulang.' })
    @IsUUID('4', { message: 'clientRequestId tidak valid' })
    clientRequestId!: string;
}

export class InterpretationDto {
    @ApiProperty()
    @IsNumber()
    minScore!: number;

    @ApiProperty()
    @IsNumber()
    maxScore!: number;

    @ApiProperty()
    @IsString()
    title!: string;

    @ApiProperty()
    @IsString()
    interpretation!: string;
}

export class CreateInterpretationDto extends InterpretationDto {
    @ApiProperty({ description: 'UUID stabil untuk mencegah data ganda saat permintaan diulang.' })
    @IsUUID('4', { message: 'clientRequestId tidak valid' })
    clientRequestId!: string;

    @ApiProperty()
    @IsUUID('4', { message: 'dimensionId tidak valid' })
    dimensionId!: string;
}

export class ImportRowDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    Judul?: string;

    @ApiPropertyOptional({ description: 'Versi teks polos; dipakai bila Konten_HTML kosong.' })
    @IsOptional()
    @IsString()
    Konten?: string;

    @ApiPropertyOptional({ description: 'Versi berformat; didahulukan.' })
    @IsOptional()
    @IsString()
    Konten_HTML?: string;
}

export class ImportRowsDto {
    @ApiProperty({ description: 'UUID stabil untuk membuat retry impor aman.' })
    @IsUUID('4', { message: 'clientRequestId tidak valid' })
    clientRequestId!: string;

    @ApiProperty({ type: [ImportRowDto] })
    @IsArray()
    @ArrayNotEmpty({ message: 'Tidak ada baris untuk diimpor.' })
    @ValidateNested({ each: true })
    @Type(() => ImportRowDto)
    rows!: ImportRowDto[];
}
