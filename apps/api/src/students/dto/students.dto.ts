import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsArray,
    IsBoolean,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsString,
    Length,
    IsUUID,
    ValidateNested,
} from 'class-validator';

export class JoinClassDto {
    @ApiProperty({ example: 'X7K2QM' })
    @IsString()
    @IsNotEmpty({ message: 'Kode kelas wajib diisi.' })
    joinCode!: string;
}

export class StartAttemptDto {
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

export class SubmitExamDto {
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
