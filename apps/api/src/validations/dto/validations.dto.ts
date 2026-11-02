import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    ArrayMaxSize,
    ArrayMinSize,
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsIn,
    IsISO8601,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
} from 'class-validator';

/** Batas panjang teks bebas agar payload tidak membengkak dan sesuai kolom DB. */
export const VALIDATION_TEXT_LIMITS = {
    title: 255,
    instructions: 5000,
    selectedText: 2000,
    comment: 5000,
    generalComment: 10000,
    ownerResponse: 2000,
    validators: 50,
} as const;

export class CreateValidationDto {
    @ApiPropertyOptional({ description: 'Folder pengelompokan validasi', nullable: true })
    @IsOptional()
    @IsUUID('4')
    folderId?: string | null;

    @ApiProperty({ description: 'ID bank soal yang divalidasi' })
    @IsUUID('4')
    @IsNotEmpty()
    bankId: string;

    @ApiProperty({ description: 'Daftar ID validator (guru/user yang ditunjuk)', type: [String] })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(VALIDATION_TEXT_LIMITS.validators)
    @ArrayUnique()
    @IsUUID('4', { each: true })
    validatorIds: string[];

    @ApiPropertyOptional({ description: 'Judul tugas validasi' })
    @IsOptional()
    @IsString()
    @MaxLength(VALIDATION_TEXT_LIMITS.title)
    title?: string;

    @ApiPropertyOptional({ description: 'Instruksi atau catatan khusus untuk validator' })
    @IsOptional()
    @IsString()
    @MaxLength(VALIDATION_TEXT_LIMITS.instructions)
    instructions?: string;

    @ApiPropertyOptional({ description: 'Batas waktu validasi (ISO datetime)' })
    @IsOptional()
    @IsISO8601({ strict: true })
    deadline?: string;

    @ApiPropertyOptional({
        enum: ['unanimous', 'any', 'admin_decides'],
        default: 'unanimous',
        description: 'Aturan persetujuan: unanimous (semua setuju), any (satu setuju), admin_decides',
    })
    @IsOptional()
    @IsIn(['unanimous', 'any', 'admin_decides'])
    approvalRule?: 'unanimous' | 'any' | 'admin_decides';

    @ApiPropertyOptional({ description: 'Izinkan revisi soal saat ujian aktif berjalan' })
    @IsOptional()
    @IsBoolean()
    allowEditDuringExam?: boolean;
}

export class SaveValidationNoteDto {
    @ApiProperty({ description: 'ID butir soal yang ditandai' })
    @IsUUID('4')
    @IsNotEmpty()
    questionId: string;

    @ApiProperty({
        enum: ['question_text', 'stimulus', 'option', 'general'],
        description: 'Cakupan teks yang ditandai',
    })
    @IsIn(['question_text', 'stimulus', 'option', 'general'])
    targetScope: 'question_text' | 'stimulus' | 'option' | 'general';

    @ApiPropertyOptional({ description: 'ID opsi jika menandai opsi jawaban' })
    @IsOptional()
    @IsUUID('4')
    targetOptionId?: string;

    @ApiPropertyOptional({ description: 'Potongan teks yang diblok / disorot' })
    @IsOptional()
    @IsString()
    @MaxLength(VALIDATION_TEXT_LIMITS.selectedText)
    selectedText?: string;

    @ApiProperty({ description: 'Isi catatan atau perbaikan dari validator' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(VALIDATION_TEXT_LIMITS.comment)
    comment: string;

    @ApiPropertyOptional({
        enum: ['typo', 'materi', 'kunci_jawaban', 'konstruksi', 'bahasa', 'lainnya'],
        default: 'typo',
    })
    @IsOptional()
    @IsIn(['typo', 'materi', 'kunci_jawaban', 'konstruksi', 'bahasa', 'lainnya'])
    category?: 'typo' | 'materi' | 'kunci_jawaban' | 'konstruksi' | 'bahasa' | 'lainnya';

    @ApiPropertyOptional({
        enum: ['valid', 'revision', 'rejected'],
        default: 'revision',
    })
    @IsOptional()
    @IsIn(['valid', 'revision', 'rejected'])
    statusItem?: 'valid' | 'revision' | 'rejected';
}

export class SubmitValidationDto {
    @ApiProperty({
        enum: ['approved', 'revision_needed', 'rejected'],
        description: 'Rekomendasi umum validator untuk bank soal ini',
    })
    @IsIn(['approved', 'revision_needed', 'rejected'])
    generalRecommendation: 'approved' | 'revision_needed' | 'rejected';

    @ApiPropertyOptional({ description: 'Kesimpulan akhir / catatan umum validator untuk seluruh bank soal' })
    @IsOptional()
    @IsString()
    @MaxLength(VALIDATION_TEXT_LIMITS.generalComment)
    generalComment?: string;
}

export class ResolveNoteDto {
    @ApiProperty({ description: 'Status apakah catatan sudah diperbaiki' })
    @IsBoolean()
    resolved: boolean;

    @ApiPropertyOptional({ description: 'Tanggapan pembuat soal, mis. alasan bila soal tidak diubah' })
    @IsOptional()
    @IsString()
    @MaxLength(VALIDATION_TEXT_LIMITS.ownerResponse)
    response?: string;
}

export class UpdateValidationNoteDto {
    @ApiPropertyOptional({ description: 'Isi catatan baru' })
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(VALIDATION_TEXT_LIMITS.comment)
    comment?: string;

    @ApiPropertyOptional({ enum: ['typo', 'materi', 'kunci_jawaban', 'konstruksi', 'bahasa', 'lainnya'] })
    @IsOptional()
    @IsIn(['typo', 'materi', 'kunci_jawaban', 'konstruksi', 'bahasa', 'lainnya'])
    category?: 'typo' | 'materi' | 'kunci_jawaban' | 'konstruksi' | 'bahasa' | 'lainnya';

    @ApiPropertyOptional({ enum: ['valid', 'revision', 'rejected'] })
    @IsOptional()
    @IsIn(['valid', 'revision', 'rejected'])
    statusItem?: 'valid' | 'revision' | 'rejected';
}

export class VerifyNoteDto {
    @ApiProperty({ enum: ['accepted', 'not_fixed'], description: 'Hasil pemeriksaan validator atas perbaikan' })
    @IsIn(['accepted', 'not_fixed'])
    verification: 'accepted' | 'not_fixed';
}

export class SetItemStatusDto {
    @ApiProperty({ enum: ['valid', 'revision', 'rejected'], description: 'Kelayakan butir menurut validator' })
    @IsIn(['valid', 'revision', 'rejected'])
    status: 'valid' | 'revision' | 'rejected';
}

export class UpdateValidationDto {
    @ApiPropertyOptional({ description: 'Folder tujuan; null mengeluarkan sesi dari folder', nullable: true })
    @IsOptional()
    @IsUUID('4')
    folderId?: string | null;

    @ApiPropertyOptional({ description: 'Judul tugas validasi' })
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(VALIDATION_TEXT_LIMITS.title)
    title?: string;

    @ApiPropertyOptional({ description: 'Instruksi untuk validator' })
    @IsOptional()
    @IsString()
    @MaxLength(VALIDATION_TEXT_LIMITS.instructions)
    instructions?: string;

    @ApiPropertyOptional({ description: 'Batas waktu baru (ISO datetime); null menghapus batas waktu', nullable: true })
    @IsOptional()
    @IsISO8601({ strict: true })
    deadline?: string | null;

    @ApiPropertyOptional({ type: [String], description: 'Validator yang ditambahkan' })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(VALIDATION_TEXT_LIMITS.validators)
    @ArrayUnique()
    @IsUUID('4', { each: true })
    addValidatorIds?: string[];

    @ApiPropertyOptional({ type: [String], description: 'Validator yang dikeluarkan (hanya yang belum mulai)' })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(VALIDATION_TEXT_LIMITS.validators)
    @ArrayUnique()
    @IsUUID('4', { each: true })
    removeValidatorIds?: string[];
}

export class DecideValidationDto {
    @ApiProperty({ enum: ['approved', 'revision_needed', 'rejected'] })
    @IsIn(['approved', 'revision_needed', 'rejected'])
    status: 'approved' | 'revision_needed' | 'rejected';
}

export class SaveValidationFolderDto {
    @ApiProperty({ description: 'Nama folder, misalnya ASAS 2026' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    name: string;
}
