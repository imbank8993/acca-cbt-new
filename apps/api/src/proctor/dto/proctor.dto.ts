import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayNotEmpty,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    Matches,
    MaxLength,
    Min,
    ValidateIf,
    ValidateNested,
} from 'class-validator';

export const EXAM_TYPES = ['daily', 'pas', 'pat', 'am', 'tryout', 'lainnya', 'assignment'] as const;
export const CLASS_TYPES = ['reguler', 'tambahan'] as const;

/** Bidang ujian yang dipakai baik saat membuat maupun mengubah. */
class ExamFieldsDto {
    @IsOptional()
    @IsString()
    timeZone?: string;

    @ApiProperty()
    @IsString()
    @IsNotEmpty({ message: 'Judul ujian wajib diisi.' })
    @MaxLength(200, { message: 'Judul ujian maksimal 200 karakter.' })
    title!: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(5000, { message: 'Deskripsi ujian maksimal 5000 karakter.' })
    description?: string;

    @ApiPropertyOptional({ enum: EXAM_TYPES })
    @IsOptional()
    @IsIn(EXAM_TYPES, { message: 'Jenis ujian tidak dikenal' })
    examType?: (typeof EXAM_TYPES)[number];

    @ApiProperty({ description: 'Dalam menit. Diabaikan untuk ujian bertipe assignment.' })
    @IsInt({ message: 'Durasi ujian harus berupa bilangan bulat menit.' })
    @Min(0, { message: 'Durasi ujian tidak boleh negatif.' })
    @Max(1440, { message: 'Durasi ujian maksimal 1440 menit (24 jam).' })
    duration!: number;

    @ApiPropertyOptional({
        example: '2026-06-01T07:30',
        description: 'Waktu lokal mengikuti zona waktu sekolah pada Pengaturan Umum; dikonversi ke UTC di server.',
    })
    @IsOptional()
    @IsString()
    startTime?: string;

    @ApiPropertyOptional({ example: '2026-06-01T09:30' })
    @IsOptional()
    @IsString()
    endTime?: string;

    @ApiPropertyOptional({ default: true })
    @IsOptional()
    @IsBoolean()
    randomizeQuestions?: boolean;

    @ApiPropertyOptional({ default: true })
    @IsOptional()
    @IsBoolean()
    randomizeOptions?: boolean;

    @ApiPropertyOptional({ default: false })
    @IsOptional()
    @IsBoolean()
    showResults?: boolean;

    @IsOptional()
    @IsIn(['classical', 'irt_1pl', 'irt_2pl', 'irt_3pl'])
    studentScoreType?: 'classical' | 'irt_1pl' | 'irt_2pl' | 'irt_3pl';

    @IsOptional()
    @IsBoolean()
    showAnswerKeys?: boolean;

    @ApiPropertyOptional({ default: true })
    @IsOptional()
    @IsBoolean()
    isSafeMode?: boolean;

    @IsOptional()
    @IsBoolean()
    screenshotEnabled?: boolean;

    @ApiPropertyOptional({
        nullable: true,
        minimum: 1,
        maximum: 100,
        default: 3,
        description: 'Jumlah pelanggaran sebelum ujian diselesaikan otomatis. null berarti tanpa batas.',
    })
    @ValidateIf((_object, value) => value !== undefined && value !== null)
    @IsInt({ message: 'Batas pelanggaran harus berupa bilangan bulat.' })
    @Min(1, { message: 'Batas pelanggaran minimal 1.' })
    @Max(100, { message: 'Batas pelanggaran maksimal 100.' })
    maxViolations?: number | null;

    @ApiPropertyOptional({ default: 'classical', example: 'classical,irt_2pl' })
    @IsOptional()
    @IsString()
    @Matches(/^$|^(classical|irt_1pl|irt_2pl|irt_3pl)(,(classical|irt_1pl|irt_2pl|irt_3pl))*$/, {
        message: 'Sistem penilaian tidak dikenal.',
    })
    scoringType?: string;

    @ApiPropertyOptional({ default: false })
    @IsOptional()
    @IsBoolean()
    isPublic?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(2048, { message: 'Tautan dokumen terlalu panjang.' })
    documentUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(2048, { message: 'Tautan video terlalu panjang.' })
    videoUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(50000, { message: 'Deskripsi tugas terlalu panjang.' })
    assignmentDescription?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    allowFileUpload?: boolean;

    @ApiPropertyOptional({ type: [String], default: ['pdf'] })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(20)
    @IsString({ each: true })
    @MaxLength(10, { each: true })
    allowedFileTypes?: string[];

    @ApiPropertyOptional({ default: true })
    @IsOptional()
    @IsBoolean()
    requireBank?: boolean;
}

export class CreateExamDto extends ExamFieldsDto {
    @ApiProperty({ description: 'UUID stabil untuk mencegah data ganda saat permintaan diulang.' })
    @IsUUID('4', { message: 'clientRequestId tidak valid' })
    clientRequestId!: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsUUID('4', { message: 'subjectId tidak valid' })
    subjectId?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsUUID('4', { message: 'questionBankId tidak valid' })
    questionBankId?: string;
}

export class UpdateExamDto extends ExamFieldsDto {
    @IsOptional() @IsString() expectedUpdatedAt?: string;
}

export class PublishExamDto {
    @ApiProperty()
    @IsBoolean()
    publish!: boolean;
}

export class ParticipantAssignmentDto {
    @ApiProperty()
    @IsUUID('4', { message: 'userId peserta tidak valid' })
    userId!: string;

    @ApiProperty()
    @IsUUID('4', { message: 'classId asal peserta tidak valid' })
    classId!: string;
}

export class AssignExamDto {
    @ApiProperty({ type: [String], description: 'Kelas reguler maupun tambahan.' })
    @IsArray()
    @IsUUID('4', { each: true, message: 'classIds memuat id yang tidak valid' })
    classIds!: string[];

    @ApiProperty({
        type: [ParticipantAssignmentDto],
        description: 'Peserta terpilih beserta kelas tempat ia dipilih.',
    })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ParticipantAssignmentDto)
    participantAssignments!: ParticipantAssignmentDto[];

    @ApiPropertyOptional({ default: true, description: 'Sekaligus mengaktifkan ujiannya.' })
    @IsOptional()
    @IsBoolean()
    activate?: boolean;
}

export class ExamIdsDto {
    @ApiProperty({ type: [String] })
    @IsArray()
    @IsUUID('4', { each: true, message: 'examIds memuat id yang tidak valid' })
    examIds!: string[];
}

export class SetExamScreenShareExceptionDto {
    @ApiProperty({ description: 'Aktifkan atau cabut pengecualian berbagi layar untuk satu peserta.' })
    @IsBoolean()
    enabled!: boolean;

    @ApiPropertyOptional({ maxLength: 240, description: 'Alasan pemberian pengecualian.' })
    @IsOptional()
    @IsString()
    @MaxLength(240)
    reason?: string;
}

export class ClassIdsDto {
    @ApiProperty({ type: [String] })
    @IsArray()
    @IsUUID('4', { each: true, message: 'classIds memuat id yang tidak valid' })
    classIds!: string[];
}

export class FinishAttemptDto {
    @ApiProperty({ maxLength: 240, description: 'Alasan staf menyelesaikan pengerjaan; dicatat pada pengerjaan.' })
    @IsString()
    @IsNotEmpty({ message: 'Tuliskan alasan menyelesaikan pengerjaan.' })
    @MaxLength(240, { message: 'Alasan maksimal 240 karakter.' })
    reason!: string;
}

export class GradeAssignmentDto {
    @IsString()
    @IsNotEmpty()
    submittedAt!: string;

    @ApiProperty({ minimum: 0, maximum: 100 })
    @IsNumber()
    @Min(0, { message: 'Nilai minimal 0' })
    @Max(100, { message: 'Nilai maksimal 100' })
    score!: number;

    @ApiPropertyOptional({ default: '' })
    @IsOptional()
    @IsString()
    feedback?: string;
}

// ── Kelas ────────────────────────────────────────────────────────────────────

export class ClassFieldsDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty({ message: 'Nama kelas wajib diisi.' })
    name!: string;

    @ApiProperty({ enum: CLASS_TYPES })
    @IsIn(CLASS_TYPES, { message: 'Jenis kelas harus reguler atau tambahan' })
    type!: (typeof CLASS_TYPES)[number];

    @ApiPropertyOptional({ example: '2025/2026' })
    @IsOptional()
    @IsString()
    schoolYear?: string;
}

export class CreateClassDto extends ClassFieldsDto {
    @ApiProperty({ description: 'UUID stabil untuk mencegah data ganda saat permintaan diulang.' })
    @IsUUID('4', { message: 'clientRequestId tidak valid' })
    clientRequestId!: string;
}

export class UpdateClassDto extends ClassFieldsDto {}

export class ImportClassesDto {
    @ApiProperty({ description: 'UUID stabil untuk membuat retry impor aman.' })
    @IsUUID('4', { message: 'clientRequestId tidak valid' })
    clientRequestId!: string;

    @ApiProperty({ type: [ClassFieldsDto] })
    @IsArray()
    @ArrayNotEmpty({ message: 'Tidak ada kelas untuk diimpor.' })
    @ValidateNested({ each: true })
    @Type(() => ClassFieldsDto)
    classes!: ClassFieldsDto[];
}

// ── Tahun ajaran ─────────────────────────────────────────────────────────────

export class CreateSchoolYearDto {
    @ApiProperty({ description: 'UUID stabil untuk mencegah data ganda saat permintaan diulang.' })
    @IsUUID('4', { message: 'clientRequestId tidak valid' })
    clientRequestId!: string;

    @ApiProperty({ example: '2025/2026' })
    @IsString()
    @IsNotEmpty({ message: 'Tahun ajaran wajib diisi.' })
    year!: string;

    @ApiPropertyOptional({ example: '2025-07-01' })
    @IsOptional()
    @IsString()
    startDate?: string;

    @ApiPropertyOptional({ example: '2026-06-30' })
    @IsOptional()
    @IsString()
    endDate?: string;
}

export class RecentLoginsQueryDto {
    @ApiPropertyOptional({ default: 10 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(200)
    limit?: number;
}
