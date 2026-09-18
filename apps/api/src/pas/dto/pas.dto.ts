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

/** Tanggal `YYYY-MM-DD` dan jam `HH:mm[:ss]` — lihat catatan di ExamConfigs DTO. */
const DATE_EXAMPLE = '2026-06-01';

export class CreatePASPeriodDto {
    @ApiProperty()
    @IsUUID('4', { message: 'organizationId tidak valid' })
    organizationId!: string;

    @ApiProperty({ example: 'PAS Ganjil 2025/2026' })
    @IsString()
    @IsNotEmpty({ message: 'Nama periode wajib diisi.' })
    name!: string;

    @ApiPropertyOptional({ default: 'pas' })
    @IsOptional()
    @IsString()
    type?: string;

    @ApiProperty({ example: '2025/2026' })
    @IsString()
    @IsNotEmpty({ message: 'Tahun ajaran wajib diisi.' })
    school_year!: string;

    @ApiPropertyOptional({ default: 'ganjil' })
    @IsOptional()
    @IsString()
    semester?: string;

    @ApiProperty({ example: DATE_EXAMPLE })
    @IsString()
    @IsNotEmpty({ message: 'Tanggal mulai wajib diisi.' })
    start_date!: string;

    @ApiProperty({ example: DATE_EXAMPLE })
    @IsString()
    @IsNotEmpty({ message: 'Tanggal selesai wajib diisi.' })
    end_date!: string;
}

export class LockPASPeriodDto {
    @ApiProperty()
    @IsBoolean({ message: 'lock harus berupa boolean' })
    lock!: boolean;
}

export class CreatePASScheduleDto {
    @ApiProperty()
    @IsUUID('4', { message: 'pas_period_id tidak valid' })
    pas_period_id!: string;

    @ApiProperty()
    @IsUUID('4', { message: 'bank_id tidak valid' })
    bank_id!: string;

    @ApiProperty()
    @IsUUID('4', { message: 'class_id tidak valid' })
    class_id!: string;

    @ApiProperty()
    @IsUUID('4', { message: 'session_id tidak valid' })
    session_id!: string;

    @ApiProperty({ example: DATE_EXAMPLE })
    @IsString()
    @IsNotEmpty({ message: 'Tanggal jadwal wajib diisi.' })
    scheduled_date!: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsUUID('4', { message: 'subject_id tidak valid' })
    subject_id?: string;

    @ApiPropertyOptional({ default: 90 })
    @IsOptional()
    @IsInt()
    @Min(1, { message: 'Durasi minimal 1 menit' })
    @Max(600, { message: 'Durasi maksimal 600 menit' })
    duration_override?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    room?: string;
}

export class GeneratePASExamsDto {
    @ApiProperty({ type: [String] })
    @IsArray()
    @ArrayNotEmpty({ message: 'Pilih minimal satu jadwal untuk dibangkitkan.' })
    @IsUUID('4', { each: true, message: 'scheduleIds memuat id yang tidak valid' })
    scheduleIds!: string[];
}

export class CreatePASSessionDto {
    @ApiProperty({ example: 'Sesi 1' })
    @IsString()
    @IsNotEmpty({ message: 'Nama sesi wajib diisi.' })
    name!: string;

    @ApiProperty({ example: '07:30' })
    @IsString()
    @IsNotEmpty({ message: 'Jam mulai wajib diisi.' })
    start_time!: string;

    @ApiProperty({ example: '09:30' })
    @IsString()
    @IsNotEmpty({ message: 'Jam selesai wajib diisi.' })
    end_time!: string;
}

export class CreatePASRoomDto {
    @ApiProperty({ example: 'Lab Komputer 1' })
    @IsString()
    @IsNotEmpty({ message: 'Nama ruang wajib diisi.' })
    name!: string;

    @ApiProperty({ example: 30 })
    @IsInt()
    @Min(1, { message: 'Kapasitas minimal 1' })
    capacity!: number;
}

export class AssignUsersDto {
    @ApiProperty({ type: [String], description: 'Boleh kosong untuk mengosongkan penugasan.' })
    @IsArray()
    @IsUUID('4', { each: true, message: 'userIds memuat id yang tidak valid' })
    userIds!: string[];
}

export class AssignRoomStudentsDto extends AssignUsersDto {
    @ApiProperty()
    @IsUUID('4', { message: 'roomId tidak valid' })
    roomId!: string;
}
