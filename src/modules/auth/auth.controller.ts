// src/modules/auth/auth.controller.ts
import {
  Controller, Post, Get, Body, Req,
  UseGuards, HttpCode, HttpStatus, Ip,
} from '@nestjs/common';
import {
  ApiTags, ApiBearerAuth, ApiOperation, ApiResponse,
} from '@nestjs/swagger';
import { Throttle }     from '@nestjs/throttler';
import { AuthService }  from './auth.service';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { CurrentUser }  from '../../shared/decorators/current-user.decorator';
import {
  LoginDto, VerifyOtpDto, RegisterDto, RefreshTokenDto,
  ForgotPasswordDto, ResetPasswordDto, ChangePasswordDto,
  ResendOtpDto,
} from './dto/auth.dto';

@ApiTags('Authentication')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ── POST /api/v1/auth/login ────────────────────────────────────────────
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 attempts per minute
  @ApiOperation({ summary: 'Step 1 — Email + password login' })
  @ApiResponse({
    status: 200,
    description: 'Returns tokens if MFA disabled, or tempToken if MFA enabled',
  })
  async login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.authService.login(dto, ip);
  }

  // ── POST /api/v1/auth/verify-otp ──────────────────────────────────────
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Step 2 — Verify OTP for MFA' })
  async verifyOtp(@Body() dto: VerifyOtpDto, @Ip() ip: string) {
    return this.authService.verifyOtp(dto, ip);
  }

  // ── POST /api/v1/auth/resend-otp ──────────────────────────────────────
  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60000 } }) // 3 resends per minute
  @ApiOperation({ summary: 'Resend OTP to email' })
  async resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto.tempToken);
  }

  // ── POST /api/v1/auth/register ────────────────────────────────────────
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Register a new user' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // ── POST /api/v1/auth/refresh ─────────────────────────────────────────
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  async refresh(@Body() dto: RefreshTokenDto, @Ip() ip: string) {
    return this.authService.refreshToken(dto, ip);
  }

  // ── POST /api/v1/auth/logout ──────────────────────────────────────────
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and revoke refresh token' })
  async logout(
    @CurrentUser() userId: string,
    @Body() body: { refreshToken?: string },
  ) {
    return this.authService.logout(userId, body.refreshToken);
  }

  // ── POST /api/v1/auth/forgot-password ─────────────────────────────────
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 300000 } }) // 3 per 5 minutes
  @ApiOperation({ summary: 'Request password reset email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  // ── POST /api/v1/auth/reset-password ──────────────────────────────────
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using token from email' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  // ── POST /api/v1/auth/change-password ─────────────────────────────────
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change password while authenticated' })
  async changePassword(
    @CurrentUser() userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, dto);
  }

  // ── GET /api/v1/auth/me ───────────────────────────────────────────────
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  async getProfile(@CurrentUser() userId: string) {
    return this.authService.getProfile(userId);
  }
}
