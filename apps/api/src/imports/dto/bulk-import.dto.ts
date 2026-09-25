import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { QUESTION_TYPES } from '../../questions/dto/questions.dto';
import {
    ArrayNotEmpty,
    IsArray,
    IsBoolean,
    IsIn,
    IsNumber,
    IsObject,
    IsOptional,
    IsString,
    ValidateNested,
} from 'class-validator';

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export class BulkQuestionOptionDto {
    @ApiProperty()
    @IsString()
    option_text!: string;

    @ApiPropertyOptional({ default: false })
    @IsOptional()
    @IsBoolean()
    is_correct?: boolean;

    @ApiPropertyOptional({ default: 0 })
    @IsOptional()
    @IsNumber()
    order?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    weight?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsObject()
    metadata?: Record<string, any>;
}

export class BulkQuestionDto {
    @ApiProperty()
    @IsString()
    question_text!: string;

    @ApiPropertyOptional({ default: 'mcq' })
    @IsOptional()
    @IsIn(QUESTION_TYPES)
    type?: string;

    @ApiPropertyOptional({ enum: DIFFICULTIES, default: 'medium' })
    @IsOptional()
    @IsIn(DIFFICULTIES, { message: 'difficulty harus easy, medium, atau hard' })
    difficulty?: (typeof DIFFICULTIES)[number];

    @ApiPropertyOptional({ default: 1 })
    @IsOptional()
    @IsNumber()
    score_default?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsObject()
    metadata?: Record<string, any>;

    @ApiPropertyOptional({ type: [BulkQuestionOptionDto] })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => BulkQuestionOptionDto)
    options?: BulkQuestionOptionDto[];
}

export class BulkImportDto {
    @ApiProperty({ type: [BulkQuestionDto] })
    @IsArray()
    @ArrayNotEmpty({ message: 'Tidak ada soal untuk diimpor.' })
    @ValidateNested({ each: true })
    @Type(() => BulkQuestionDto)
    questions!: BulkQuestionDto[];
}
