import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@acca-cbt/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { LoginDto, SsoTicketDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Masuk dengan email dan password' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Post('sso')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tukar tiket SSO acca-app dengan sesi CBT' })
  sso(@Body() dto: SsoTicketDto) {
    return this.authService.exchangeSsoTicket(dto.token);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Identitas dan peran pemanggil saat ini' })
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Profil pemanggil beserta organisasi utamanya',
    description:
      'Untuk bilah sisi: foto profil, nama sekolah, dan logonya. Terpisah dari /auth/me ' +
      'karena ketiganya butuh query tambahan yang tidak dibutuhkan setiap pemanggil identitas.',
  })
  profile(@CurrentUser() user: AuthUser) {
    return this.authService.getProfileWithOrganization(user);
  }

}
