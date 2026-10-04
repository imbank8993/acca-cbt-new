import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Metadata klien yang diteruskan oleh proxy Next.js. NestJS berada di belakang
 * proxy, sehingga `req.ip` hanya berisi IP server web, bukan IP pengguna.
 * Wajib dideklarasikan di DTO karena ValidationPipe memakai `whitelist: true`.
 * Sengaja tanpa batas panjang: nilai aneh tidak boleh menggagalkan login —
 * pemotongan dilakukan saat pencatatan (LoginHistoryService).
 */
export class ClientMetaDto {
  @ApiPropertyOptional({ description: 'IP asli klien (diteruskan proxy web)' })
  @IsOptional()
  @IsString()
  ipAddress?: string;

  @ApiPropertyOptional({ description: 'User-Agent asli klien (diteruskan proxy web)' })
  @IsOptional()
  @IsString()
  userAgent?: string;
}

export class LoginDto extends ClientMetaDto {
  @ApiProperty({ example: 'guru@sekolah.sch.id' })
  @IsString()
  @IsNotEmpty({ message: 'Email wajib diisi' })
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Password wajib diisi' })
  password!: string;
}

export class SsoTicketDto extends ClientMetaDto {
  @ApiProperty({ description: 'Tiket JWT terbitan acca-app, ditandatangani CBT_SSO_SECRET' })
  @IsString()
  @IsNotEmpty({ message: 'Tiket SSO wajib diisi' })
  token!: string;
}
