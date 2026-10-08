import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsUUID,
} from 'class-validator';

export class CreateValidationDto {
    @ApiProperty({ description: 'ID bank soal yang divalidasi' })
    @IsUUID('4')
    @IsNotEmpty()
    bankId: string;

    @ApiProperty({ description: 'Daftar ID validator (guru/user yang ditunjuk)', type: [String] })
    @IsArray()
    @ArrayMinSize(1)
    @IsUUID('4', { each: true })
    validatorIds: string[];

    @ApiPropertyOptional({ description: 'Judul tugas validasi' })
    @IsOptional()
    @IsString()
    title?: string;

    @ApiPropertyOptional({ description: 'Instruksi atau catatan khusus untuk validator' })
    @IsOptional()
    @IsString()
    instructions?: string;

    @ApiPropertyOptional({ description: 'Batas waktu validasi (ISO datetime)' })
    @IsOptional()
    @IsString()
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
    selectedText?: string;

    @ApiProperty({ description: 'Isi catatan atau perbaikan dari validator' })
    @IsString()
    @IsNotEmpty()
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
    generalComment?: string;
}

export class ResolveNoteDto {
    @ApiProperty({ description: 'Status apakah catatan sudah diperbaiki' })
    @IsBoolean()
    resolved: boolean;
}
