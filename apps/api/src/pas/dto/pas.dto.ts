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
    @IsOptional() @IsBoolean()
    screenshot_enabled?: boolean;
    @ApiProperty({ description: 'UUID stabil untuk mencegah data ganda saat permintaan diulang.' })
    @IsUUID('4', { message: 'clientRequestId tidak valid' })
    clientRequestId!: string;

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

    @ApiPropertyOptional({ example: 'Drs. H. Ahmad Fauzi, M.Pd.' })
    @IsOptional()
    @IsString()
    committee_chair_name?: string;

    @ApiPropertyOptional({ example: '197505102000031002' })
    @IsOptional()
    @IsString()
    committee_chair_nip?: string;
}

export class UpdatePASCommitteeChairDto {
    @ApiProperty({ example: 'Drs. H. Ahmad Fauzi, M.Pd.' })
    @IsString()
    @IsNotEmpty({ message: 'Nama Ketua Panitia wajib diisi.' })
    committee_chair_name!: string;

    @ApiPropertyOptional({ example: '197505102000031002' })
    @IsOptional()
    @IsString()
    committee_chair_nip?: string;
}

export class UpdatePASPeriodDto {
    @ApiPropertyOptional({ example: 'PAS Ganjil 2025/2026' })
    @IsOptional()
    @IsString()
    name?: string;

    @ApiPropertyOptional({ default: 'pas' })
    @IsOptional()
    @IsString()
    type?: string;

    @ApiPropertyOptional({ example: '2025/2026' })
    @IsOptional()
    @IsString()
    school_year?: string;

    @ApiPropertyOptional({ default: 'ganjil' })
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

    @ApiPropertyOptional({ example: 'Drs. H. Ahmad Fauzi, M.Pd.' })
    @IsOptional()
    @IsString()
    committee_chair_name?: string;

    @ApiPropertyOptional({ example: '197505102000031002' })
    @IsOptional()
    @IsString()
    committee_chair_nip?: string;
}

export class LockPASPeriodDto {
    @ApiProperty()
    @IsBoolean({ message: 'lock harus berupa boolean' })
    lock!: boolean;
}

export class CreatePASScheduleDto {
    @ApiProperty({ description: 'UUID stabil untuk mencegah data ganda saat permintaan diulang.' })
    @IsUUID('4', { message: 'clientRequestId tidak valid' })
    clientRequestId!: string;

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

export class PASActivationDto {
    @IsBoolean()
    active!: boolean;
}

export class CreatePASSessionDto {
    @ApiProperty({ description: 'UUID stabil untuk mencegah data ganda saat permintaan diulang.' })
    @IsUUID('4', { message: 'clientRequestId tidak valid' })
    clientRequestId!: string;

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
    @ApiProperty({ description: 'UUID stabil untuk mencegah data ganda saat permintaan diulang.' })
    @IsUUID('4', { message: 'clientRequestId tidak valid' })
    clientRequestId!: string;

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

export class AssignRoomInvigilatorsDto extends AssignUsersDto {
    @ApiProperty({ description: 'Sesi tempat pengawas bertugas di ruang ini.' })
    @IsUUID('4', { message: 'Pilih sesi ujian yang valid.' })
    sessionId!: string;

    @ApiProperty({ example: DATE_EXAMPLE, description: 'Tanggal bertugas; pengawas bergilir setiap hari.' })
    @IsString()
    @IsNotEmpty({ message: 'Pilih tanggal bertugas pengawas.' })
    examDate!: string;
}

export class CopyRoomInvigilatorsDto {
    @ApiProperty({ example: DATE_EXAMPLE, description: 'Tanggal sumber yang disalin.' })
    @IsString()
    @IsNotEmpty({ message: 'Pilih tanggal sumber.' })
    fromDate!: string;

    @ApiProperty({ example: DATE_EXAMPLE, description: 'Tanggal tujuan; penugasannya diganti seluruhnya.' })
    @IsString()
    @IsNotEmpty({ message: 'Pilih tanggal tujuan.' })
    toDate!: string;
}

export class PASStudentAttendanceItemDto {
    @ApiProperty()
    @IsUUID('4', { message: 'user_id peserta tidak valid' })
    user_id!: string;

    @ApiProperty({ example: 'hadir', enum: ['hadir', 'sakit', 'izin', 'alpha'] })
    @IsString()
    @IsNotEmpty()
    status!: 'hadir' | 'sakit' | 'izin' | 'alpha';

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    remark?: string;
}

export class SavePASAdministrationDto {
    @ApiProperty()
    @IsUUID('4', { message: 'pas_period_id tidak valid' })
    pas_period_id!: string;

    @ApiProperty()
    @IsUUID('4', { message: 'pas_room_id tidak valid' })
    pas_room_id!: string;

    @ApiProperty()
    @IsUUID('4', { message: 'session_id tidak valid' })
    session_id!: string;

    @ApiProperty({ example: DATE_EXAMPLE })
    @IsString()
    @IsNotEmpty({ message: 'Tanggal pelaksanaan wajib diisi.' })
    exam_date!: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    notes?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    incident_summary?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsUUID('4', { message: 'invigilator_id tidak valid' })
    invigilator_id?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    invigilator_name?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsUUID('4', { message: 'proctor_id tidak valid' })
    proctor_id?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    proctor_name?: string;

    @ApiPropertyOptional({ type: [PASStudentAttendanceItemDto] })
    @IsOptional()
    @IsArray()
    attendances?: PASStudentAttendanceItemDto[];

    @ApiPropertyOptional({ enum: ['save_draft', 'submit', 'approve'] })
    @IsOptional()
    @IsString()
    action?: 'save_draft' | 'submit' | 'approve';
}

export class ApprovePASAdministrationDto {
    @ApiProperty()
    @IsUUID('4', { message: 'pas_period_id tidak valid' })
    pas_period_id!: string;

    @ApiProperty()
    @IsUUID('4', { message: 'pas_room_id tidak valid' })
    pas_room_id!: string;

    @ApiProperty()
    @IsUUID('4', { message: 'session_id tidak valid' })
    session_id!: string;

    @ApiProperty({ example: DATE_EXAMPLE })
    @IsString()
    @IsNotEmpty({ message: 'Tanggal pelaksanaan wajib diisi.' })
    exam_date!: string;
}

export class RejectPASAdministrationDto extends ApprovePASAdministrationDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    rejection_note?: string;
}

