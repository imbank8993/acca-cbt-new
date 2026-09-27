import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsObject, IsString, IsUUID } from 'class-validator';

export class CreateClassDto {
    @ApiProperty({ example: 'Kelas Tambahan Matematika' })
    @IsString()
    @IsNotEmpty({ message: 'Nama kelas wajib diisi' })
    name!: string;

    @ApiProperty({ description: 'UUID stabil untuk mencegah data ganda saat permintaan diulang.' })
    @IsUUID('4', { message: 'clientRequestId tidak valid' })
    clientRequestId!: string;
}

export class AddStudentDto {
    @ApiProperty()
    @IsUUID('4', { message: 'studentId tidak valid' })
    studentId!: string;
}

export class SubmitGradesDto {
    @ApiProperty({
        description: 'Peta id jawaban → nilai',
        example: { '8f1c…': 8, 'a2d0…': 10 },
    })
    // Nilainya divalidasi di service karena kuncinya dinamis (id jawaban).
    @IsObject({ message: 'grades harus berupa objek' })
    grades!: Record<string, number>;
}

export class ScoreEntryDto {
    @IsNumber()
    score!: number;
}
