// src/modules/auth/auth.service.ts
//
// Auth business logic — covers the full auth lifecycle:
//
//   login → (optional MFA) → verify-otp → tokens
//   register → email-verify-otp
//   refresh  → token rotation (via ITokenProvider)
//   logout   → revoke one or all tokens
//   forgot-password → reset-password
//   change-password (authenticated)
//   get-profile
//
// Token issuance/refresh/revocation is delegated to ITokenProvider so
// that switching to Keycloak requires zero changes here.

import {
  Injectable, Logger, UnauthorizedException,
  ConflictException, BadRequestException,
  NotFoundException, ForbiddenException, Inject,
} from '@nestjs/common';
import { JwtService }     from '@nestjs/jwt';
import { ConfigService }  from '@nestjs/config';
import { PrismaService }  from '../../shared/prisma/prisma.service';
import { EmailService }   from '../../shared/services/email.service';
import * as bcrypt        from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import {
  LoginDto, VerifyOtpDto, RegisterDto,
  ForgotPasswordDto, ResetPasswordDto,
  ChangePasswordDto, RefreshTokenDto,
} from './dto/auth.dto';
import {
  ITokenProvider, TOKEN_PROVIDER,
} from './providers/token-provider.interface';

const SALT_ROUNDS        = 12;
const OTP_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS   = 5;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINS = 15;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly jwtService:    JwtService,
    private readonly config:        ConfigService,
    private readonly emailService:  EmailService,
    @Inject(TOKEN_PROVIDER)
    private readonly tokenProvider: ITokenProvider,
  ) {}

  // ── STEP 1: Login with email + password ────────────────────────────────

  async login(dto: LoginDto, ip?: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase().trim() },
    });

    // Always run bcrypt compare — prevents timing attacks even when user not found
    const dummyHash = '$2b$12$dummyhashfortimingattackprevention1234567890';
    const passwordToCheck = user?.passwordHash ?? dummyHash;
    const isValid = await bcrypt.compare(dto.password, passwordToCheck);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Account lockout check
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new ForbiddenException(`Account locked. Try again in ${minutesLeft} minutes.`);
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

    return this.tokenProvider.issueTokens(user, ip);
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

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const otpRecord = await this.prisma.otpCode.findFirst({
      where: {
        userId:    user.id,
        type:      'MFA_LOGIN',
        usedAt:    null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      throw new UnauthorizedException('OTP expired or not found. Request a new code.');
    }

    if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
      throw new ForbiddenException('Too many incorrect attempts. Request a new code.');
    }

    const inputHash = this.hashOtp(dto.otp);
    if (otpRecord.code !== inputHash) {
      await this.prisma.otpCode.update({
        where: { id: otpRecord.id },
        data:  { attempts: { increment: 1 } },
      });
      const remaining = MAX_OTP_ATTEMPTS - otpRecord.attempts - 1;
      throw new UnauthorizedException(
        `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
      );
    }

    await this.prisma.otpCode.update({
      where: { id: otpRecord.id },
      data:  { usedAt: new Date() },
    });

    return this.tokenProvider.issueTokens(user, ip);
  }

  // ── Resend OTP ─────────────────────────────────────────────────────────

  async resendOtp(tempToken: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(tempToken, { secret: this.config.get('JWT_SECRET') });
    } catch {
      throw new UnauthorizedException('Session expired. Please log in again.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new NotFoundException('User not found');

    await this.generateAndSendOtp(user.id, user.tenantId, user.email, user.name, 'MFA_LOGIN');
    return { message: `New code sent to ${this.maskEmail(user.email)}` };
  }

  // ── Register new user ──────────────────────────────────────────────────

  async register(dto: RegisterDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: dto.tenantId } }) as any;
    if (!tenant) throw new NotFoundException('Organisation not found');

    // Check user limit for tenant plan (uses new Tenant.maxUsers / Tenant.plan fields)
    const userCount = await this.prisma.user.count({ where: { tenantId: dto.tenantId, isActive: true } });
    if (userCount >= (tenant.maxUsers ?? 5)) {
      throw new ForbiddenException(
        `Your plan (${tenant.plan ?? 'STARTER'}) allows up to ${tenant.maxUsers ?? 5} users. ` +
        `Upgrade to add more.`,
      );
    }

    const existing = await this.prisma.user.findFirst({
      where: { tenantId: dto.tenantId, email: dto.email.toLowerCase().trim() },
    });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const roleNames    = dto.roles ?? ['MERCHANDISER'];

    // Resolve Role IDs from the roles table (new Role model — cast prisma to any
    // until `prisma generate` is re-run against the migrated schema)
    const prismaAny  = this.prisma as any;
    const roleRecords: any[] = await prismaAny.role.findMany({
      where: {
        name:     { in: roleNames },
        OR: [{ tenantId: null }, { tenantId: dto.tenantId }],
        isActive: true,
      },
    });

    // Create user + UserRole rows in one transaction
    const user = await this.prisma.$transaction(async (tx) => {
      const txAny = tx as any;
      const created = await txAny.user.create({
        data: {
          tenantId:     dto.tenantId,
          email:        dto.email.toLowerCase().trim(),
          name:         dto.name,
          passwordHash,
          roles:        roleNames,    // denormalised cache
          isActive:     true,
          isMfaEnabled: false,        // MFA disabled
        },
      });

      if (roleRecords.length > 0) {
        await txAny.userRole.createMany({
          data: roleRecords.map((role: any) => ({
            userId:   created.id,
            roleId:   role.id,
            tenantId: dto.tenantId,
          })),
          skipDuplicates: true,
        });
      }

      return created;
    });

    // Send email verification OTP
    await this.generateAndSendOtp(user.id, user.tenantId, user.email, user.name, 'EMAIL_VERIFY');

    return {
      message: `Account created. Check ${this.maskEmail(user.email)} to verify your email.`,
      userId:  user.id,
    };
  }

  // ── Refresh access token ───────────────────────────────────────────────

  async refreshToken(dto: RefreshTokenDto, ip?: string) {
    return this.tokenProvider.refreshTokens(dto.refreshToken, ip);
  }

  // ── Logout (revoke one token) ──────────────────────────────────────────

  async logout(userId: string, refreshToken?: string) {
    await this.tokenProvider.revokeTokens(userId, refreshToken);
    return { message: 'Logged out successfully' };
  }

  // ── Logout all devices ─────────────────────────────────────────────────

  async logoutAll(userId: string) {
    await this.tokenProvider.revokeTokens(userId);
    return { message: 'Logged out from all devices' };
  }

  // ── Forgot password ────────────────────────────────────────────────────

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase().trim() },
    });

    // Never reveal whether email exists
    if (!user) {
      return { message: 'If that email is registered, a reset link has been sent.' };
    }

    const token      = randomBytes(32).toString('hex');
    const tokenHash  = this.hashToken(token);
    const expiresAt  = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await this.prisma.passwordReset.create({
      data: { userId: user.id, tenantId: user.tenantId, tokenHash, expiresAt },
    });

    const resetUrl = `${this.config.get('WEB_URL')}/auth/reset-password?token=${token}`;
    await this.emailService.sendPasswordReset({ to: user.email, name: user.name, resetUrl });

    return { message: 'If that email is registered, a reset link has been sent.' };
  }

  // ── Reset password ─────────────────────────────────────────────────────

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash   = this.hashToken(dto.token);
    const resetRecord = await this.prisma.passwordReset.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });

    if (!resetRecord) {
      throw new BadRequestException('Invalid or expired reset link');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetRecord.userId },
        data:  { passwordHash, failedLoginCount: 0, lockedUntil: null },
      }),
      this.prisma.passwordReset.update({
        where: { id: resetRecord.id },
        data:  { usedAt: new Date() },
      }),
      // Force re-login on all devices after password reset
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
      throw new BadRequestException('New password must differ from current password');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

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

    // Load UserRole → Role relations via the new model (cast until prisma generate runs)
    const prismaAny   = this.prisma as any;
    const userRoles: any[] = await prismaAny.userRole.findMany({
      where: {
        userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: { role: { select: { name: true, permissions: true } } },
    }).catch(() => []);   // graceful degradation if table doesn't exist yet

    const permissions: string[] = Array.from(
      new Set((userRoles as any[]).flatMap((ur: any) => ur.role?.permissions ?? [])),
    );

    return {
      id:              user.id,
      email:           user.email,
      name:            user.name,
      roles:           user.roles,
      permissions,
      tenantId:        user.tenantId,
      isMfaEnabled:    user.isMfaEnabled,
      isEmailVerified: user.isEmailVerified,
      lastLoginAt:     user.lastLoginAt,
      createdAt:       user.createdAt,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private async issueTempToken(user: any): Promise<string> {
    return this.jwtService.sign(
      { sub: user.id, email: user.email, tenantId: user.tenantId, type: 'temp' },
      { secret: this.config.get('JWT_SECRET'), expiresIn: '10m' },
    );
  }

  private async generateAndSendOtp(
    userId: string, tenantId: string, email: string, name: string, type: string,
  ): Promise<void> {
    // Invalidate previous OTPs of the same type
    await this.prisma.otpCode.updateMany({
      where: { userId, type, usedAt: null },
      data:  { usedAt: new Date() },
    });

    const otp      = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash  = this.hashOtp(otp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await this.prisma.otpCode.create({
      data: { userId, tenantId, code: otpHash, type, expiresAt },
    });

    await this.emailService.sendMfaOtp({ to: email, name, otp, expiresMinutes: OTP_EXPIRY_MINUTES });
  }

  private async handleFailedLogin(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    const newCount  = user.failedLoginCount + 1;
    const lockUntil = newCount >= MAX_LOGIN_ATTEMPTS
      ? new Date(Date.now() + LOCK_DURATION_MINS * 60 * 1000)
      : null;

    await this.prisma.user.update({
      where: { id: userId },
      data:  { failedLoginCount: newCount, lockedUntil: lockUntil },
    });
  }

  private hashOtp(otp: string):     string { return createHash('sha256').update(otp).digest('hex'); }
  private hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    return `${local[0]}***@${domain}`;
  }
}
