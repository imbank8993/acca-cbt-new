import { IsBoolean, IsIn, IsInt, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class CreateMaterialDto {
    @IsUUID() id!: string;
    @IsString() @MinLength(1) @MaxLength(200) title!: string;
}
export class UpdateMaterialDto {
    @IsInt() @Min(1) revision!: number;
    @IsString() @MinLength(1) @MaxLength(200) title!: string;
    @IsString() @MaxLength(4000) description!: string;
    @IsString() @MaxLength(100) subject!: string;
    @IsIn(['draft', 'published']) status!: 'draft' | 'published';
    @IsIn(['html', 'word', 'latex', 'text', 'pdf', 'image', 'audio', 'video', 'attachment']) format!: string;
    @IsString() @MaxLength(6_000_000) contentHtml!: string;
    @IsString() @MaxLength(8000) conversionNotes!: string;
}
export class ProgressDto {
    @IsBoolean() completed!: boolean;
}
