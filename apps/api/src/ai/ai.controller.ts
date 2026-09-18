import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AiService } from './ai.service';

class KisiKisiDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty({ message: 'Teks soal wajib diisi' })
    questionText!: string;

    @ApiProperty({ required: false, type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    options?: string[];
}

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
// Hanya staf yang boleh memakai fitur AI. Versi lama tidak memeriksa apa pun,
// sehingga siapa pun yang bisa memanggilnya dapat menghabiskan kuota OpenAI.
@Roles('ADMIN', 'PROKTOR', 'GURU')
export class AiController {
    constructor(private readonly ai: AiService) {}

    @Post('kisi-kisi')
    @ApiOperation({ summary: 'Susun kisi-kisi untuk satu soal' })
    generateKisiKisi(@Body() dto: KisiKisiDto) {
        return this.ai.generateKisiKisi(dto.questionText, dto.options ?? []);
    }
}
