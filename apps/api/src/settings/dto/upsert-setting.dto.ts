import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsNotEmpty, IsString } from 'class-validator';

export class UpsertSettingDto {
    @ApiProperty({ example: 'app_config' })
    @IsString()
    @IsNotEmpty({ message: 'Key pengaturan wajib diisi' })
    key!: string;

    @ApiProperty({
        description: 'Nilai apa pun yang bisa diserialisasi JSON',
        example: { app_name: 'ACCA CBT' },
    })
    // Hanya dipastikan ADA, bukan bertipe tertentu: kolomnya jsonb dan
    // pemanggil menyimpan objek, array, maupun skalar. `null` sah sebagai cara
    // mengosongkan pengaturan.
    @IsDefined({ message: 'Nilai pengaturan wajib disertakan' })
    value!: unknown;
}
