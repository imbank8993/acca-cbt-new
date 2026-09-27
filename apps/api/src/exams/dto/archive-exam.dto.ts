import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ArchiveExamDto {
    @ApiProperty({ description: 'true untuk arsip, false untuk pulihkan ke draft' })
    @IsBoolean({ message: 'archived harus berupa boolean' })
    archived!: boolean;
}
