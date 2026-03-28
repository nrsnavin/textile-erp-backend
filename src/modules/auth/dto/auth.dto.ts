// src/modules/auth/dto/auth.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail, IsString, MinLength, MaxLength,
  IsUUID, IsOptional, Matches, Length,
} from 'class-validator';

// ── Login ─────────────────────────────────────────────────────────────────
export class LoginDto {
  @ApiProperty({ example: 'user@factory.com' })
  @IsEmail({}, { message: 'Please enter a valid email address' })
  email: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;
}

// ── Verify OTP (MFA step) ─────────────────────────────────────────────────
export class VerifyOtpDto {
  @ApiProperty({ description: 'Temporary token received after successful password check' })
  @IsString()
  tempToken: string;

  @ApiProperty({ example: '123456', description: '6-digit OTP sent to email' })
  @IsString()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  @Matches(/^\d{6}$/, { message: 'OTP must contain only digits' })
  otp: string;
}

// ── Register ──────────────────────────────────────────────────────────────
export class RegisterDto {
  @ApiProperty({ example: 'Anuja Sharma' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'user@factory.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @MinLength(8)
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
    { message: 'Password must have uppercase, lowercase, number and special character' }
  )
  password: string;

  @ApiProperty()
  @IsUUID()
  tenantId: string;

  @ApiPropertyOptional({ default: ['MERCHANDISER'] })
  @IsOptional()
  @IsString({ each: true })
  roles?: string[];
}

// ── Refresh token ─────────────────────────────────────────────────────────
export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;
}

// ── Forgot password ───────────────────────────────────────────────────────
export class ForgotPasswordDto {
  @ApiProperty({ example: 'user@factory.com' })
  @IsEmail()
  email: string;
}

// ── Reset password ────────────────────────────────────────────────────────
export class ResetPasswordDto {
  @ApiProperty({ description: 'Token received in email' })
  @IsString()
  token: string;

  @ApiProperty({ example: 'NewSecurePass123!' })
  @IsString()
  @MinLength(8)
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
    { message: 'Password must have uppercase, lowercase, number and special character' }
  )
  newPassword: string;
}

// ── Change password ───────────────────────────────────────────────────────
export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  currentPassword: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
    { message: 'Password must have uppercase, lowercase, number and special character' }
  )
  newPassword: string;
}

// ── Resend OTP ────────────────────────────────────────────────────────────
export class ResendOtpDto {
  @ApiProperty()
  @IsString()
  tempToken: string;
}
