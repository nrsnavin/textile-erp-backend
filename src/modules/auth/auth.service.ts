// src/modules/auth/auth.service.ts
import {
  Injectable, Logger, UnauthorizedException,
  ConflictException, BadRequestException,
  NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { JwtService }     from '@nestjs/jwt';
import { ConfigService }  from '@nestjs/config';
// CORRECT — go up two levels to reach src/
import { PrismaService } from '../../shared/prisma/prisma.service';
import { EmailService }  from '../../shared/services/email.service';
import * as bcrypt        from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import {
  LoginDto, VerifyOtpDto, RegisterDto,
  ForgotPasswordDto, ResetPasswordDto,
  ChangePasswordDto, RefreshTokenDto,
} from './dto/auth.dto';

const SALT_ROUNDS         = 12;
const OTP_EXPIRY_MINUTES  = 10;
const MAX_OTP_ATTEMPTS    = 5;
const MAX_LOGIN_ATTEMPTS  = 5;
const LOCK_DURATION_MINS  = 15;
const REFRESH_EXPIRY_DAYS = 7;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma:       PrismaService,
    private readonly jwtService:   JwtService,
    private readonly config:       ConfigService,
    private readonly emailService: EmailService,
  ) {}

  // ── STEP 1: Login with email + password ────────────────────────────────
  async login(dto: LoginDto, ip?: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase().trim() },
    });

    // Always run bcrypt compare — prevents timing attacks
    const dummyHash = '$2b$12$dummyhashfortimingattackprevention1234567890';
    const passwordToCheck = user?.passwordHash ?? dummyHash;
    const isValid = await bcrypt.compare(dto.password, passwordToCheck);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Check account lock
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / 60000
      );
      throw new ForbiddenException(
        `Account locked. Try again in ${minutesLeft} minutes.`
      );
    }

    if (!isValid) {
      await this.handleFailedLogin(user.id);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Account is deactivated. Contact your administrator.');
    }

    // Reset failed attempts on successful password check
    await this.prisma.user.update({
      where: { id: user.id },
      data:  { failedLoginCount: 0, lockedUntil: null },
    });

    // If MFA is enabled — issue temp token and send OTP
    if (user.isMfaEnabled) {
      const tempToken = await this.issueTempToken(user);
      await this.generateAndSendOtp(user.id, user.tenantId, user.email, user.name, 'MFA_LOGIN');

      return {
        requiresMfa: true,
        tempToken,
        message:     `A 6-digit code has been sent to ${this.maskEmail(user.email)}`,
      };
    }

    // MFA not enabled — issue access token directly
    return this.issueTokens(user, ip);
  }

  // ── STEP 2: Verify OTP (MFA) ───────────────────────────────────────────
  async verifyOtp(dto: VerifyOtpDto, ip?: string) {
    // Validate temp token
    let payload: any;
    try {
      payload = this.jwtService.verify(dto.tempToken, {
        secret: this.config.get('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired session. Please log in again.');
    }

    if (payload.type !== 'temp') {
      throw new UnauthorizedException('Invalid token type');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Find the most recent unused OTP
    const otpRecord = await this.prisma.otpCode.findFirst({
      where: {
        userId:  user.id,
        type:    'MFA_LOGIN',
        usedAt:  null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      throw new UnauthorizedException('OTP expired or not found. Request a new code.');
    }

    // Check attempt count
    if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
      throw new ForbiddenException('Too many incorrect attempts. Request a new code.');
    }

    // Verify OTP hash
    const inputHash = this.hashOtp(dto.otp);
    if (otpRecord.code !== inputHash) {
      // Increment attempt count
      await this.prisma.otpCode.update({
        where: { id: otpRecord.id },
        data:  { attempts: { increment: 1 } },
      });
      const remaining = MAX_OTP_ATTEMPTS - otpRecord.attempts - 1;
      throw new UnauthorizedException(
        `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
      );
    }

    // Mark OTP as used
    await this.prisma.otpCode.update({
      where: { id: otpRecord.id },
      data:  { usedAt: new Date() },
    });

    return this.issueTokens(user, ip);
  }

  // ── Resend OTP ─────────────────────────────────────────────────────────
  async resendOtp(tempToken: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(tempToken, {
        secret: this.config.get('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Session expired. Please log in again.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) throw new NotFoundException('User not found');

    await this.generateAndSendOtp(
      user.id, user.tenantId, user.email, user.name, 'MFA_LOGIN'
    );

    return { message: `New code sent to ${this.maskEmail(user.email)}` };
  }

  // ── Register new user ──────────────────────────────────────────────────
  async register(dto: RegisterDto) {
    // Check tenant exists
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: dto.tenantId },
    });
    if (!tenant) throw new NotFoundException('Organisation not found');

    // Check email uniqueness within tenant
    const existing = await this.prisma.user.findFirst({
      where: { tenantId: dto.tenantId, email: dto.email.toLowerCase().trim() },
    });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        tenantId:     dto.tenantId,
        email:        dto.email.toLowerCase().trim(),
        name:         dto.name,
        passwordHash,
        roles:        dto.roles ?? ['MERCHANDISER'],
        isActive:     true,
        isMfaEnabled: true,  // MFA enabled by default for security
      },
    });

    // Send email verification OTP
    await this.generateAndSendOtp(
      user.id, user.tenantId, user.email, user.name, 'EMAIL_VERIFY'
    );

    return {
      message: `Account created. Check ${this.maskEmail(user.email)} to verify your email.`,
      userId:  user.id,
    };
  }

  // ── Refresh access token ───────────────────────────────────────────────
  async refreshToken(dto: RefreshTokenDto, ip?: string) {
    const tokenHash = this.hashToken(dto.refreshToken);

    const stored = await this.prisma.refreshToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!stored || !stored.user.isActive) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Revoke used token (rotation — one-time use)
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data:  { revokedAt: new Date() },
    });

    return this.issueTokens(stored.user, ip);
  }

  // ── Logout ─────────────────────────────────────────────────────────────
  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      const tokenHash = this.hashToken(refreshToken);
      await this.prisma.refreshToken.updateMany({
        where: { userId, tokenHash },
        data:  { revokedAt: new Date() },
      });
    }

    // Update last login
    await this.prisma.user.update({
      where: { id: userId },
      data:  { lastLoginAt: new Date() },
    });

    return { message: 'Logged out successfully' };
  }

  // ── Forgot password ────────────────────────────────────────────────────
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase().trim() },
    });

    // Always return success — never reveal if email exists
    if (!user) {
      return { message: 'If that email is registered, a reset link has been sent.' };
    }

    const token     = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await this.prisma.passwordReset.create({
      data: {
        userId:    user.id,
        tenantId:  user.tenantId,
        tokenHash,
        expiresAt,
      },
    });

    const resetUrl = `${this.config.get('WEB_URL')}/auth/reset-password?token=${token}`;

    await this.emailService.sendPasswordReset({
      to:       user.email,
      name:     user.name,
      resetUrl,
    });

    return { message: 'If that email is registered, a reset link has been sent.' };
  }

  // ── Reset password ─────────────────────────────────────────────────────
  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = this.hashToken(dto.token);

    const resetRecord = await this.prisma.passwordReset.findFirst({
      where: {
        tokenHash,
        usedAt:    null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!resetRecord) {
      throw new BadRequestException('Invalid or expired reset link');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);

    await this.prisma.$transaction([
      // Update password
      this.prisma.user.update({
        where: { id: resetRecord.userId },
        data:  { passwordHash, failedLoginCount: 0, lockedUntil: null },
      }),
      // Mark token used
      this.prisma.passwordReset.update({
        where: { id: resetRecord.id },
        data:  { usedAt: new Date() },
      }),
      // Revoke all refresh tokens — force re-login on all devices
      this.prisma.refreshToken.updateMany({
        where: { userId: resetRecord.userId, revokedAt: null },
        data:  { revokedAt: new Date() },
      }),
    ]);

    return { message: 'Password reset successfully. Please log in.' };
  }

  // ── Change password (authenticated) ───────────────────────────────────
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const isValid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!isValid) throw new UnauthorizedException('Current password is incorrect');

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must be different from current password');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);

    await this.prisma.user.update({
      where: { id: userId },
      data:  { passwordHash },
    });

    return { message: 'Password changed successfully' };
  }

  // ── Get current user profile ───────────────────────────────────────────
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: {
        id:              true,
        email:           true,
        name:            true,
        roles:           true,
        tenantId:        true,
        isMfaEnabled:    true,
        isEmailVerified: true,
        lastLoginAt:     true,
        createdAt:       true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private async issueTokens(user: any, ip?: string) {
    const payload = {
      sub:      user.id,
      email:    user.email,
      tenantId: user.tenantId,
      roles:    user.roles,
      type:     'access',
    };

    const accessToken = this.jwtService.sign(payload, {
      secret:    this.config.get('JWT_SECRET'),
      expiresIn: this.config.get('JWT_EXPIRES_IN', '15m'),
    });

    // Generate refresh token
    const rawRefresh   = randomBytes(40).toString('hex');
    const refreshHash  = this.hashToken(rawRefresh);
    const refreshExpiry = new Date();
    refreshExpiry.setDate(refreshExpiry.getDate() + REFRESH_EXPIRY_DAYS);

    await this.prisma.refreshToken.create({
      data: {
        userId:    user.id,
        tenantId:  user.tenantId,
        tokenHash: refreshHash,
        expiresAt: refreshExpiry,
        ipAddress: ip,
      },
    });

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data:  { lastLoginAt: new Date() },
    });

    return {
      requiresMfa:  false,
      accessToken,
      refreshToken: rawRefresh,
      expiresIn:    900, // 15 minutes in seconds
      user: {
        id:           user.id,
        email:        user.email,
        name:         user.name,
        roles:        user.roles,
        tenantId:     user.tenantId,
        isMfaEnabled: user.isMfaEnabled,
      },
    };
  }

  private async issueTempToken(user: any): Promise<string> {
    return this.jwtService.sign(
      { sub: user.id, email: user.email, tenantId: user.tenantId, type: 'temp' },
      { secret: this.config.get('JWT_SECRET'), expiresIn: '10m' },
    );
  }

  private async generateAndSendOtp(
    userId:   string,
    tenantId: string,
    email:    string,
    name:     string,
    type:     string,
  ): Promise<void> {
    // Invalidate previous OTPs of same type
    await this.prisma.otpCode.updateMany({
      where: { userId, type, usedAt: null },
      data:  { usedAt: new Date() },
    });

    // Generate 6-digit OTP
    const otp     = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = this.hashOtp(otp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await this.prisma.otpCode.create({
      data: { userId, tenantId, code: otpHash, type, expiresAt },
    });

    // Send via email
    await this.emailService.sendMfaOtp({
      to:             email,
      name,
      otp,
      expiresMinutes: OTP_EXPIRY_MINUTES,
    });
  }

  private async handleFailedLogin(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    const newCount = user.failedLoginCount + 1;
    const lockUntil = newCount >= MAX_LOGIN_ATTEMPTS
      ? new Date(Date.now() + LOCK_DURATION_MINS * 60 * 1000)
      : null;

    await this.prisma.user.update({
      where: { id: userId },
      data:  { failedLoginCount: newCount, lockedUntil: lockUntil },
    });
  }

  private hashOtp(otp: string): string {
    return createHash('sha256').update(otp).digest('hex');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    return `${local[0]}***@${domain}`;
  }
}
