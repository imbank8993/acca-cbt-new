import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'guru@sekolah.sch.id' })
  @IsString()
  @IsNotEmpty({ message: 'Email wajib diisi' })
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Password wajib diisi' })
  password!: string;
}

export class SsoTicketDto {
  @ApiProperty({ description: 'Tiket JWT terbitan acca-app, ditandatangani CBT_SSO_SECRET' })
  @IsString()
  @IsNotEmpty({ message: 'Tiket SSO wajib diisi' })
  token!: string;
}
