import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@acca-cbt/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { LoginDto, SsoTicketDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RateLimiter, tooManyRequests } from '../common/rate-limit';

/** Gagal login per akun: cukup untuk salah ketik, terlalu sedikit untuk menebak NIS/sandi. */
const ACCOUNT_FAILURE_LIMIT = 10;
/** Per IP lebih longgar: satu sekolah sering keluar lewat satu IP NAT yang sama. */
const IP_FAILURE_LIMIT = 200;
const FAILURE_WINDOW_MS = 15 * 60_000;
export const loginFailures = new RateLimiter();

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Masuk dengan email dan password' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const ip = dto.ipAddress || req.ip;
    const ua = dto.userAgent || req.headers['user-agent'];
    const accountKey = `account:${String(dto.email || '').trim().toLowerCase()}`;
    const ipKey = `ip:${ip || 'unknown'}`;
    const wait = Math.max(loginFailures.blocked(accountKey, ACCOUNT_FAILURE_LIMIT),
      loginFailures.blocked(ipKey, IP_FAILURE_LIMIT));
    if (wait) {
      throw tooManyRequests(wait, `Terlalu banyak percobaan login gagal. Coba lagi dalam ${Math.ceil(wait / 60)} menit.`);
    }
    try {
      const result = await this.authService.login(dto.email, dto.password, ip, ua);
      loginFailures.reset(accountKey);
      return result;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        loginFailures.hit(accountKey, ACCOUNT_FAILURE_LIMIT, FAILURE_WINDOW_MS);
        loginFailures.hit(ipKey, IP_FAILURE_LIMIT, FAILURE_WINDOW_MS);
      }
      throw error;
    }
  }

  @Post('sso')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tukar tiket SSO acca-app dengan sesi CBT' })
  sso(@Body() dto: SsoTicketDto, @Req() req: Request) {
    const ip = dto.ipAddress || req.ip;
    const ua = dto.userAgent || req.headers['user-agent'];
    return this.authService.exchangeSsoTicket(dto.token, ip, ua);
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
