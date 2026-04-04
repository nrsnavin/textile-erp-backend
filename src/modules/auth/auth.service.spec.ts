// src/modules/auth/auth.service.spec.ts

// Mock bcrypt at module level — compare is non-configurable so spyOn fails
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash:    jest.fn().mockResolvedValue('$2b$12$hashed'),
}));

import { Test, TestingModule }    from '@nestjs/testing';
import { JwtService }             from '@nestjs/jwt';
import { ConfigService }          from '@nestjs/config';
import {
  UnauthorizedException, ForbiddenException,
  ConflictException, BadRequestException, NotFoundException,
} from '@nestjs/common';
import * as bcrypt                from 'bcrypt';
import { AuthService }            from './auth.service';
import { PrismaService }          from '../../shared/prisma/prisma.service';
import { EmailService }           from '../../shared/services/email.service';
import {
  ITokenProvider, TOKEN_PROVIDER, TokenResponse,
} from './providers/token-provider.interface';
import {
  LoginDto, VerifyOtpDto, RegisterDto,
  ForgotPasswordDto, ResetPasswordDto, ChangePasswordDto, RefreshTokenDto,
} from './dto/auth.dto';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid-1';
const USER_ID   = 'user-uuid-1';
const IP        = '127.0.0.1';

const mockUser = {
  id:               USER_ID,
  tenantId:         TENANT_ID,
  email:            'dev@factory.com',
  name:             'Dev User',
  passwordHash:     '$2b$12$abc',   // placeholder — compare is mocked
  roles:            ['MERCHANDISER'],
  isActive:         true,
  isMfaEnabled:     false,
  isEmailVerified:  false,
  failedLoginCount: 0,
  lockedUntil:      null,
  lastLoginAt:      null,
  createdAt:        new Date('2026-01-01'),
  updatedAt:        new Date('2026-01-01'),
};

const mockTenant = {
  id:       TENANT_ID,
  name:     'Demo Garments',
  slug:     'demo',
  plan:     'STARTER',
  status:   'ACTIVE',
  maxUsers: 5,
};

const mockTokenResponse: TokenResponse = {
  requiresMfa:  false,
  accessToken:  'access.jwt.token',
  refreshToken: 'raw-refresh-token',
  expiresIn:    900,
  user: {
    id:           USER_ID,
    email:        mockUser.email,
    name:         mockUser.name,
    roles:        ['MERCHANDISER'],
    permissions:  ['buyers:read'],
    tenantId:     TENANT_ID,
    isMfaEnabled: false,
  },
};

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  user:          { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  tenant:        { findUnique: jest.fn() },
  role:          { findMany: jest.fn() },
  userRole:      { findMany: jest.fn(), createMany: jest.fn() },
  otpCode:       { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  refreshToken:  { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  passwordReset: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  $transaction:  jest.fn(),
};

const mockJwtService = {
  sign:   jest.fn(),
  verify: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string, def?: string) => {
    const map: Record<string, string> = {
      JWT_SECRET:     'test-secret',
      JWT_EXPIRES_IN: '15m',
      WEB_URL:        'http://localhost:3003',
    };
    return map[key] ?? def;
  }),
};

const mockEmailService = {
  sendMfaOtp:        jest.fn(),
  sendPasswordReset: jest.fn(),
};

const mockTokenProvider: ITokenProvider = {
  providerName:  'mock',
  issueTokens:   jest.fn(),
  refreshTokens: jest.fn(),
  revokeTokens:  jest.fn(),
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: userRole.findMany returns empty array (getProfile graceful fallback)
    mockPrisma.userRole.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService,   useValue: mockPrisma },
        { provide: JwtService,      useValue: mockJwtService },
        { provide: ConfigService,   useValue: mockConfigService },
        { provide: EmailService,    useValue: mockEmailService },
        { provide: TOKEN_PROVIDER,  useValue: mockTokenProvider },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ── login ──────────────────────────────────────────────────────────────

  describe('login', () => {
    const dto: LoginDto = { email: 'dev@factory.com', password: 'SecurePass123!' };

    it('issues tokens directly when MFA is disabled', async () => {
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue(mockUser);
      (mockTokenProvider.issueTokens as jest.Mock).mockResolvedValue(mockTokenResponse);

      const result = await service.login(dto, IP);

      expect(mockTokenProvider.issueTokens).toHaveBeenCalledWith(mockUser, IP);
      expect(result).toEqual(mockTokenResponse);
    });

    it('returns tempToken + requiresMfa when MFA is enabled', async () => {
      const mfaUser = { ...mockUser, isMfaEnabled: true };
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      mockPrisma.user.findFirst.mockResolvedValue(mfaUser);
      mockPrisma.user.update.mockResolvedValue(mfaUser);
      mockPrisma.otpCode.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.otpCode.create.mockResolvedValue({});
      mockJwtService.sign.mockReturnValue('temp.jwt.token');
      mockEmailService.sendMfaOtp.mockResolvedValue(undefined);

      const result = await service.login(dto, IP);

      expect(result).toMatchObject({ requiresMfa: true, tempToken: 'temp.jwt.token' });
      expect(mockTokenProvider.issueTokens).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException for wrong password', async () => {
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue(mockUser);
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.login(dto, IP))
        .rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for unknown email', async () => {
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(service.login(dto, IP))
        .rejects.toThrow(UnauthorizedException);
    });

    it('throws ForbiddenException when account is locked', async () => {
      const lockedUser = {
        ...mockUser,
        lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
      };
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      mockPrisma.user.findFirst.mockResolvedValue(lockedUser);

      await expect(service.login(dto, IP))
        .rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for deactivated account', async () => {
      const inactiveUser = { ...mockUser, isActive: false };
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      mockPrisma.user.findFirst.mockResolvedValue(inactiveUser);
      mockPrisma.user.update.mockResolvedValue(inactiveUser);

      await expect(service.login(dto, IP))
        .rejects.toThrow(ForbiddenException);
    });

    it('increments failedLoginCount on wrong password', async () => {
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue({});

      await expect(service.login(dto, IP)).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ failedLoginCount: 1 }),
        }),
      );
    });

    it('locks account after MAX_LOGIN_ATTEMPTS failures', async () => {
      const almostLockedUser = { ...mockUser, failedLoginCount: 4 };
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);
      mockPrisma.user.findFirst.mockResolvedValue(almostLockedUser);
      mockPrisma.user.findUnique.mockResolvedValue(almostLockedUser);
      mockPrisma.user.update.mockResolvedValue({});

      await expect(service.login(dto, IP)).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            failedLoginCount: 5,
            lockedUntil:      expect.any(Date),
          }),
        }),
      );
    });
  });

  // ── verifyOtp ──────────────────────────────────────────────────────────

  describe('verifyOtp', () => {
    const dto: VerifyOtpDto = { tempToken: 'temp.jwt.token', otp: '123456' };

    const otpRecord = {
      id:       'otp-1',
      code:     require('crypto').createHash('sha256').update('123456').digest('hex'),
      attempts: 0,
      expiresAt: new Date(Date.now() + 600_000),
    };

    it('issues tokens when OTP is correct', async () => {
      mockJwtService.verify.mockReturnValue({ sub: USER_ID, type: 'temp' });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.otpCode.findFirst.mockResolvedValue(otpRecord);
      mockPrisma.otpCode.update.mockResolvedValue({});
      (mockTokenProvider.issueTokens as jest.Mock).mockResolvedValue(mockTokenResponse);

      const result = await service.verifyOtp(dto, IP);

      expect(mockPrisma.otpCode.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { usedAt: expect.any(Date) } }),
      );
      expect(result).toEqual(mockTokenResponse);
    });

    it('throws UnauthorizedException for expired temp token', async () => {
      mockJwtService.verify.mockImplementation(() => { throw new Error('expired'); });

      await expect(service.verifyOtp(dto, IP)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when OTP not found', async () => {
      mockJwtService.verify.mockReturnValue({ sub: USER_ID, type: 'temp' });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.otpCode.findFirst.mockResolvedValue(null);

      await expect(service.verifyOtp(dto, IP)).rejects.toThrow(UnauthorizedException);
    });

    it('throws ForbiddenException when OTP attempts exhausted', async () => {
      mockJwtService.verify.mockReturnValue({ sub: USER_ID, type: 'temp' });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.otpCode.findFirst.mockResolvedValue({ ...otpRecord, attempts: 5 });

      await expect(service.verifyOtp(dto, IP)).rejects.toThrow(ForbiddenException);
    });

    it('throws UnauthorizedException for wrong OTP and increments attempts', async () => {
      mockJwtService.verify.mockReturnValue({ sub: USER_ID, type: 'temp' });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.otpCode.findFirst.mockResolvedValue({ ...otpRecord, code: 'wrong-hash' });
      mockPrisma.otpCode.update.mockResolvedValue({});

      await expect(service.verifyOtp({ ...dto, otp: '000000' }, IP))
        .rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.otpCode.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { attempts: { increment: 1 } } }),
      );
    });
  });

  // ── register ───────────────────────────────────────────────────────────

  describe('register', () => {
    const dto: RegisterDto = {
      name:     'New User',
      email:    'new@factory.com',
      password: 'SecurePass123!',
      tenantId: TENANT_ID,
      roles:    ['MERCHANDISER'],
    };

    it('creates user and UserRole, sends verify email', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(mockTenant);
      mockPrisma.user.count.mockResolvedValue(2);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.role.findMany.mockResolvedValue([{ id: 'role-1', name: 'MERCHANDISER' }]);
      mockPrisma.$transaction.mockImplementation(async (fn) =>
        fn({
          user:     { create: jest.fn().mockResolvedValue({ ...mockUser, id: 'new-user-id' }) },
          userRole: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
        }),
      );
      mockPrisma.otpCode.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.otpCode.create.mockResolvedValue({});
      mockEmailService.sendMfaOtp.mockResolvedValue(undefined);

      const result = await service.register(dto);

      expect(result).toMatchObject({ message: expect.stringContaining('Account created') });
      expect(mockEmailService.sendMfaOtp).toHaveBeenCalled();
    });

    it('throws NotFoundException when tenant not found', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.register(dto)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when tenant user limit is reached', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(mockTenant); // maxUsers: 5
      mockPrisma.user.count.mockResolvedValue(5);

      await expect(service.register(dto)).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException for duplicate email in tenant', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(mockTenant);
      mockPrisma.user.count.mockResolvedValue(1);
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });
  });

  // ── refreshToken ───────────────────────────────────────────────────────

  describe('refreshToken', () => {
    it('delegates to tokenProvider.refreshTokens', async () => {
      (mockTokenProvider.refreshTokens as jest.Mock).mockResolvedValue(mockTokenResponse);
      const dto: RefreshTokenDto = { refreshToken: 'raw-token' };

      const result = await service.refreshToken(dto, IP);

      expect(mockTokenProvider.refreshTokens).toHaveBeenCalledWith('raw-token', IP);
      expect(result).toEqual(mockTokenResponse);
    });
  });

  // ── logout ─────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('revokes specific refresh token', async () => {
      (mockTokenProvider.revokeTokens as jest.Mock).mockResolvedValue(undefined);

      const result = await service.logout(USER_ID, 'raw-token');

      expect(mockTokenProvider.revokeTokens).toHaveBeenCalledWith(USER_ID, 'raw-token');
      expect(result).toEqual({ message: 'Logged out successfully' });
    });
  });

  // ── logoutAll ──────────────────────────────────────────────────────────

  describe('logoutAll', () => {
    it('revokes all tokens for user', async () => {
      (mockTokenProvider.revokeTokens as jest.Mock).mockResolvedValue(undefined);

      const result = await service.logoutAll(USER_ID);

      expect(mockTokenProvider.revokeTokens).toHaveBeenCalledWith(USER_ID);
      expect(result).toEqual({ message: 'Logged out from all devices' });
    });
  });

  // ── forgotPassword ─────────────────────────────────────────────────────

  describe('forgotPassword', () => {
    const dto: ForgotPasswordDto = { email: 'dev@factory.com' };

    it('creates reset token and sends email', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.passwordReset.create.mockResolvedValue({});
      mockEmailService.sendPasswordReset.mockResolvedValue(undefined);

      const result = await service.forgotPassword(dto);

      expect(mockEmailService.sendPasswordReset).toHaveBeenCalledWith(
        expect.objectContaining({ to: mockUser.email }),
      );
      expect(result.message).toContain('reset link');
    });

    it('returns same message even when email not found (no enumeration)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const result = await service.forgotPassword(dto);

      expect(result.message).toContain('reset link');
      expect(mockEmailService.sendPasswordReset).not.toHaveBeenCalled();
    });
  });

  // ── resetPassword ──────────────────────────────────────────────────────

  describe('resetPassword', () => {
    const dto: ResetPasswordDto = { token: 'raw-reset-token', newPassword: 'NewPass123!' };

    it('resets password and revokes all refresh tokens', async () => {
      mockPrisma.passwordReset.findFirst.mockResolvedValue({
        id: 'reset-1', userId: USER_ID, user: mockUser,
      });
      mockPrisma.$transaction.mockResolvedValue([]);

      const result = await service.resetPassword(dto);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(result.message).toContain('Password reset');
    });

    it('throws BadRequestException for invalid or expired token', async () => {
      mockPrisma.passwordReset.findFirst.mockResolvedValue(null);

      await expect(service.resetPassword(dto)).rejects.toThrow(BadRequestException);
    });
  });

  // ── changePassword ─────────────────────────────────────────────────────

  describe('changePassword', () => {
    const dto: ChangePasswordDto = {
      currentPassword: 'OldPass123!',
      newPassword:     'NewPass456!',
    };

    it('changes password when current password is correct', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.changePassword(USER_ID, dto);

      expect(mockPrisma.user.update).toHaveBeenCalled();
      expect(result.message).toContain('Password changed');
    });

    it('throws UnauthorizedException when current password is wrong', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(service.changePassword(USER_ID, dto))
        .rejects.toThrow(UnauthorizedException);
    });

    it('throws BadRequestException when new password equals current', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await expect(
        service.changePassword(USER_ID, { currentPassword: 'Same1!', newPassword: 'Same1!' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── getProfile ─────────────────────────────────────────────────────────

  describe('getProfile', () => {
    it('returns user profile with merged permissions', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser });
      mockPrisma.userRole.findMany.mockResolvedValue([
        { role: { name: 'MERCHANDISER', permissions: ['buyers:read', 'orders:read'] } },
      ]);

      const result = await service.getProfile(USER_ID);

      expect(result).toMatchObject({
        id:          USER_ID,
        email:       mockUser.email,
        permissions: expect.arrayContaining(['buyers:read', 'orders:read']),
      });
    });

    it('throws NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('bad-id')).rejects.toThrow(NotFoundException);
    });
  });
});
