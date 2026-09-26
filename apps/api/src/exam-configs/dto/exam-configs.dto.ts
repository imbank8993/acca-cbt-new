import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    ArrayNotEmpty,
    IsArray,
    IsBoolean,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    Min,
} from 'class-validator';

/**
 * Tanggal dan jam dikirim sebagai string `YYYY-MM-DD` / `HH:mm[:ss]` — bentuk
 * yang dihasilkan `<input type="date">` dan `<input type="time">`, dan bentuk
 * yang diterima kolom `date` / `time` di PostgreSQL. Tidak dijadikan `Date`
 * supaya tidak ada pergeseran zona waktu di jalan; konversi ke UTC hanya
 * terjadi sekali, saat ujian dibangkitkan (lihat ExamConfigsService).
 */
const DATE_EXAMPLE = '2026-06-01';
const TIME_EXAMPLE = '07:30';

export class CreateExamConfigDto {
    @ApiProperty({ example: 'PAS Ganjil 2026' })
    @IsString()
    @IsNotEmpty({ message: 'Nama ujian folder wajib diisi.' })
    name!: string;

    @ApiPropertyOptional({ example: '2025/2026' })
    @IsOptional()
    @IsString()
    school_year?: string;

    @ApiPropertyOptional({ example: 'ganjil' })
    @IsOptional()
    @IsString()
    semester?: string;

    @ApiPropertyOptional({ example: DATE_EXAMPLE })
    @IsOptional()
    @IsString()
    start_date?: string;

    @ApiPropertyOptional({ example: DATE_EXAMPLE })
    @IsOptional()
    @IsString()
    end_date?: string;
}

export class UpdateExamConfigDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    name?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    school_year?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    semester?: string;

    @ApiPropertyOptional({ example: DATE_EXAMPLE })
    @IsOptional()
    @IsString()
    start_date?: string;

    @ApiPropertyOptional({ example: DATE_EXAMPLE })
    @IsOptional()
    @IsString()
    end_date?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    is_locked?: boolean;
}

export class LockExamConfigDto {
    @ApiProperty()
    @IsBoolean({ message: 'lock harus berupa boolean' })
    lock!: boolean;
}

export class AddExamConfigBankDto {
    @ApiProperty()
    @IsUUID('4', { message: 'exam_config_id tidak valid' })
    exam_config_id!: string;

    @ApiProperty()
    @IsUUID('4', { message: 'bank_id tidak valid' })
    bank_id!: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsUUID('4', { message: 'subject_id tidak valid' })
    subject_id?: string;

    @ApiPropertyOptional({ default: 90 })
    @IsOptional()
    @IsInt()
    @Min(1, { message: 'Durasi minimal 1 menit' })
    @Max(600, { message: 'Durasi maksimal 600 menit' })
    duration_minutes?: number;
}

export class UpdateExamConfigBankDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsUUID('4', { message: 'subject_id tidak valid' })
    subject_id?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsInt()
    @Min(1, { message: 'Durasi minimal 1 menit' })
    @Max(600, { message: 'Durasi maksimal 600 menit' })
    duration_minutes?: number;
}

export class AddExamConfigExamDto {
    @ApiProperty()
    @IsUUID('4', { message: 'exam_config_id tidak valid' })
    exam_config_id!: string;

    @ApiProperty()
    @IsUUID('4', { message: 'exam_config_bank_id tidak valid' })
    exam_config_bank_id!: string;

    @ApiProperty()
    @IsUUID('4', { message: 'class_id tidak valid' })
    class_id!: string;

    @ApiPropertyOptional({ example: DATE_EXAMPLE })
    @IsOptional()
    @IsString()
    scheduled_date?: string;

    @ApiPropertyOptional({ example: TIME_EXAMPLE })
    @IsOptional()
    @IsString()
    scheduled_time?: string;

    @ApiPropertyOptional({ example: '09:30' })
    @IsOptional()
    @IsString()
    window_end_time?: string;
}

export class GenerateExamsDto {
    @ApiProperty({ type: [String] })
    @IsArray()
    @ArrayNotEmpty({ message: 'Pilih minimal satu jadwal untuk dibangkitkan.' })
    @IsUUID('4', { each: true, message: 'configExamIds memuat id yang tidak valid' })
    configExamIds!: string[];
}
