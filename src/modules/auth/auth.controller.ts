// src/modules/auth/auth.controller.ts
import {
  Controller, Post, Get, Body, HttpCode, HttpStatus, Ip,
  UseGuards, Headers,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody } from '@nestjs/swagger';
import { AuthService }  from './auth.service';
import { JwtAuthGuard } from '../../shared/guards/jwt-auth.guard';
import { CurrentUser }  from '../../shared/decorators/current-user.decorator';
import {
  LoginDto, VerifyOtpDto, RegisterDto,
  RefreshTokenDto, ForgotPasswordDto,
  ResetPasswordDto, ChangePasswordDto, ResendOtpDto,
} from './dto/auth.dto';

@ApiTags('Authentication')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ── Public endpoints ────────────────────────────────────────────────────

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'Creates a user within an existing tenant. ' +
      'MFA is enabled by default; an OTP is sent to verify the email address.',
  })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Step 1 — Password login',
    description:
      'Returns access + refresh tokens if MFA is disabled. ' +
      'Returns a short-lived tempToken if MFA is enabled — pass it to /verify-otp.',
  })
  async login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.authService.login(dto, ip);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Step 2 — MFA: verify the 6-digit OTP',
    description:
      'Exchange the tempToken + OTP for a full access + refresh token pair.',
  })
  async verifyOtp(@Body() dto: VerifyOtpDto, @Ip() ip: string) {
    return this.authService.verifyOtp(dto, ip);
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend OTP to email (requires valid tempToken)' })
  async resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto.tempToken);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Exchange a valid refresh token for a new access + refresh token pair. ' +
      'The consumed refresh token is immediately revoked (rotation).',
  })
  async refresh(@Body() dto: RefreshTokenDto, @Ip() ip: string) {
    return this.authService.refreshToken(dto, ip);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a password reset email',
    description: 'Always returns 200 — never reveals whether the email exists.',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using the token from the reset email' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  // ── Authenticated endpoints ─────────────────────────────────────────────

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current user profile',
    description: 'Returns profile, roles, and merged permissions for the authenticated user.',
  })
  async getProfile(@CurrentUser() userId: string) {
    return this.authService.getProfile(userId);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change password (authenticated)',
    description: 'Requires the current password. Does not invalidate existing sessions.',
  })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() userId: string,
  ) {
    return this.authService.changePassword(userId, dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Logout — revoke current refresh token',
    description:
      'Pass the refresh token in the body to revoke only the current device session. ' +
      'Omit it to keep other sessions alive.',
  })
  @ApiBody({ schema: { properties: { refreshToken: { type: 'string' } }, required: [] } })
  async logout(
    @CurrentUser() userId: string,
    @Body('refreshToken') refreshToken?: string,
  ) {
    return this.authService.logout(userId, refreshToken);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Logout all devices — revoke every active refresh token',
    description: 'Use this after a suspected account compromise.',
  })
  async logoutAll(@CurrentUser() userId: string) {
    return this.authService.logoutAll(userId);
  }
}
