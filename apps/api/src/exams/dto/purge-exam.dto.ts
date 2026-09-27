import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class PurgeExamDto {
    @ApiProperty({ description: 'Judul ujian yang diketik ulang sebagai konfirmasi eksplisit.' })
    @IsString()
    @IsNotEmpty({ message: 'Ketik ulang judul ujian untuk mengonfirmasi penghapusan.' })
    confirmationTitle!: string;
}
