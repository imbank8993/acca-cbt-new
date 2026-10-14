import { IsArray, IsInt, IsString, IsUUID, MaxLength, Min, ArrayMaxSize, ArrayMinSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
class KeyChangeDto {
    @IsUUID() questionId!: string;
    @IsString() @MaxLength(20000) key!: string;
}
export class ExamKeyCorrectionDto {
    @IsInt() @Min(0) revision!: number;
    @IsString() @MaxLength(1000) reason!: string;
    @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300)
    @ValidateNested({ each: true }) @Type(() => KeyChangeDto) changes!: KeyChangeDto[];
}
