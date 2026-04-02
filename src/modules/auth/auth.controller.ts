import { Controller, Post, Get, Body, UseGuards, HttpCode, HttpStatus, Ip } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthService }  from './auth.service';
import {
  LoginDto, VerifyOtpDto, RegisterDto,
  RefreshTokenDto, ForgotPasswordDto,
  ResetPasswordDto, ChangePasswordDto, ResendOtpDto,
} from './dto/auth.dto';

@ApiTags('Authentication')        // ← this makes it show in Swagger
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Step 1 — Email and password login' })
  async login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.authService.login(dto, ip);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Step 2 — Verify OTP for MFA' })
  async verifyOtp(@Body() dto: VerifyOtpDto, @Ip() ip: string) {
    return this.authService.verifyOtp(dto, ip);
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend OTP to email' })
  async resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto.tempToken);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(@Body() dto: RefreshTokenDto, @Ip() ip: string) {
    return this.authService.refreshToken(dto, ip);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send password reset email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using token from email' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('me')
  @UseGuards()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async getProfile() {
    return { message: 'Profile endpoint — add JwtAuthGuard when ready' };
  }
}