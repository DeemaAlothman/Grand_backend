import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LogoutDto } from './dto/logout.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const STRICT_AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

function deviceContextFrom(req: Request) {
  return {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    deviceName: (req.headers['x-device-name'] as string) || undefined,
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, deviceContextFrom(req));
  }

  @Public()
  @Throttle(STRICT_AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, deviceContextFrom(req));
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.authService.refresh(dto.refreshToken, deviceContextFrom(req));
  }

  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Body() dto: LogoutDto) {
    await this.authService.logout(dto.refreshToken);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: AuthenticatedUser) {
    await this.authService.logoutAll(user.id);
  }

  @Public()
  @Throttle(STRICT_AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.authService.forgotPassword(dto.email, deviceContextFrom(req));
    return {
      message:
        'If an account exists for this email, a reset link has been sent.',
    };
  }

  @Public()
  @Throttle(STRICT_AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    await this.authService.resetPassword(
      dto.token,
      dto.newPassword,
      deviceContextFrom(req),
    );
    return { message: 'Password has been reset successfully.' };
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
