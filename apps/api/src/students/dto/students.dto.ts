import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsArray,
    ArrayMaxSize,
    IsDateString,
    IsBoolean,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsString,
    Length,
    IsUUID,
    IsInt,
    IsIn,
    Min,
    Max,
    ValidateNested,
} from 'class-validator';
import { STUDENT_SECURITY_EVENTS, SUBMISSION_SECURITY_EVENT_LIMIT } from '../../common/student-security-events';

export class JoinClassDto {
    @ApiProperty({ example: 'X7K2QM' })
    @IsString()
    @IsNotEmpty({ message: 'Kode kelas wajib diisi.' })
    joinCode!: string;
}

export class StartAttemptDto {
    @IsOptional() @IsBoolean()
    screenCaptureReady?: boolean;
    @ApiPropertyOptional({
        description:
            'Sidik jari perangkat. Pengerjaan terikat pada perangkat pertama; ' +
            'melanjutkan dari perangkat lain ditolak sampai proktor melakukan reset.',
    })
    @IsOptional()
    @IsString()
    @Length(8, 200)
    deviceId?: string;
}

export class AnswerDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(Number.MAX_SAFE_INTEGER)
    revision?: number;

    @ApiProperty()
    @IsUUID('4', { message: 'questionId tidak valid' })
    questionId!: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    selected_option_id?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    essay_answer?: string;

    @ApiPropertyOptional({ default: false })
    @IsOptional()
    @IsBoolean()
    is_doubtful?: boolean;
}

export class SaveAnswerDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(Number.MAX_SAFE_INTEGER)
    revision?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Length(8, 200)
    deviceId?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    selected_option_id?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    essay_answer?: string;

    @ApiPropertyOptional({ default: false })
    @IsOptional()
    @IsBoolean()
    is_doubtful?: boolean;
}

export class SyncAnswersDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Length(8, 200)
    deviceId?: string;

    @ApiProperty({ type: [AnswerDto] })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => AnswerDto)
    answers!: AnswerDto[];
}

export class SyncLateAnswersDto extends SyncAnswersDto {}

export class FrozenSubmissionDto {
    @IsDateString()
    startedAt!: string;

    @IsDateString()
    personalEndTime!: string;
}

export class SubmissionSecurityEventDto {
    @IsUUID()
    id!: string;

    @IsIn(STUDENT_SECURITY_EVENTS)
    eventType!: string;

    @IsObject()
    metadata!: Record<string, unknown>;

    @IsDateString()
    createdAt!: string;
}

export class SubmitExamDto {
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(SUBMISSION_SECURITY_EVENT_LIMIT)
    @ValidateNested({ each: true })
    @Type(() => SubmissionSecurityEventDto)
    securityEvents?: SubmissionSecurityEventDto[];

    @IsOptional()
    @ValidateNested()
    @Type(() => FrozenSubmissionDto)
    frozenSubmission?: FrozenSubmissionDto;

    @ApiPropertyOptional()
    @IsOptional()
    @IsObject()
    answerRevisions?: Record<string, number>;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Length(8, 200)
    deviceId?: string;

    @ApiProperty({
        description: 'Peta id soal → jawaban mentah, seperti yang dipegang klien.',
        example: { '8f1c…': 'a2d0…', 'b31e…': '["x","y"]' },
    })
    // Kuncinya id soal yang dinamis, jadi bentuknya divalidasi di service.
    @IsObject({ message: 'answers harus berupa objek' })
    answers!: Record<string, string>;

    @ApiPropertyOptional({
        description: 'Untuk ujian bertipe assignment: tautan berkas dan teks yang dikumpulkan.',
    })
    @IsOptional()
    @IsObject()
    assignmentData?: Record<string, unknown>;

    @ApiPropertyOptional({
        description:
            'Pengerjaan yang sedang dibuka klien. Dikirim agar submit selalu mengenai ' +
            'baris yang benar meski ada lebih dari satu pengerjaan berstatus in_progress.',
    })
    @IsOptional()
    @IsUUID('4', { message: 'attemptId tidak valid' })
    attemptId?: string;
}

export class BeginSubmitDto extends StartAttemptDto {
    @IsOptional()
    @ValidateNested()
    @Type(() => SubmitExamDto)
    submission?: SubmitExamDto;
}
