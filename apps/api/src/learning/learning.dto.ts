import { IsBoolean, IsByteLength, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, Matches } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMaterialDto {
    @IsUUID() id!: string;
    @IsString() @MinLength(1) @MaxLength(200) title!: string;
    @IsOptional() @IsIn(['', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']) gradeLevel?: string;
    @IsOptional() @IsString() @MaxLength(100) subject?: string;
    @IsOptional() @IsString() @MaxLength(200) topic?: string;
    @IsOptional() @IsString() @MaxLength(200) subtopic?: string;
    @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(9999) subtopicOrder?: number;
}
export class UpdateMaterialDto {
    @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(9999) subtopicOrder?: number;
    @IsOptional() @IsString() @MaxLength(160000) @Matches(/^(?:|data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2})$/)
    coverData?: string;
    @IsOptional() @IsIn(['', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']) gradeLevel?: string;
    @IsOptional() @IsString() @MaxLength(200) topic?: string;
    @IsOptional() @IsString() @MaxLength(200) subtopic?: string;
    @Type(() => Number) @IsInt() @Min(1) revision!: number;
    @IsString() @MinLength(1) @MaxLength(200) title!: string;
    @IsString() @MaxLength(4000) description!: string;
    @IsString() @MaxLength(100) subject!: string;
    @IsIn(['draft', 'published']) status!: 'draft' | 'published';
    @IsIn(['html', 'word', 'latex', 'text', 'pdf', 'image', 'audio', 'video', 'attachment']) format!: string;
    @IsString() @MaxLength(6_000_000) @IsByteLength(0, 8 * 1024 * 1024 - 1, { message: 'Isi materi harus kurang dari 8 MB.' }) contentHtml!: string;
    @IsString() @MaxLength(8000) conversionNotes!: string;
}
export class ProgressDto {
    @IsBoolean() completed!: boolean;
    @IsInt() @Min(1) contentVersion!: number;
}
export class ActivityDto {
    @IsInt() @Min(1) contentVersion!: number;
    @IsInt() @Min(0) revision!: number;
    @IsObject() state!: Record<string, unknown>;
}
