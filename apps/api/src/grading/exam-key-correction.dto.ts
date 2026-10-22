import { IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
class KeyChangeDto {
    @IsUUID() questionId!: string;
    @IsString() @MaxLength(20000) key!: string;
}
/** Batalkan (excluded: true) atau pulihkan (false) satu soal dari penilaian. */
class VoidChangeDto {
    @IsUUID() questionId!: string;
    @IsBoolean() excluded!: boolean;
}
export class ExamKeyCorrectionDto {
    @IsInt() @Min(0) revision!: number;
    @IsString() @MaxLength(1000) reason!: string;
    // Boleh kosong bila revisi ini hanya membatalkan/memulihkan soal.
    @IsArray() @ArrayMaxSize(300)
    @ValidateNested({ each: true }) @Type(() => KeyChangeDto) changes!: KeyChangeDto[];
    @IsOptional() @IsArray() @ArrayMaxSize(300)
    @ValidateNested({ each: true }) @Type(() => VoidChangeDto) voids?: VoidChangeDto[];
}
