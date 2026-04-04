// src/modules/auth/auth.flow.spec.ts
//
// Full auth lifecycle integration tests:
//   register → login (no MFA) → GET /me → refresh → logout → stale token rejected
//   login (MFA) → verify-otp → tokens
//   logout-all → every refresh token revoked
//   account lockout after 5 failed attempts
//   forgot-password → reset-password
//   change-password (authenticated)
//
// Uses NestJS TestingModule with mock Prisma + mock EmailService.
// No real database or HTTP server required.

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash:    jest.fn().mockResolvedValue('$2b$12$hashed'),
}));

import { Test, TestingModule }    from '@nestjs/testing';
import { JwtService, JwtModule }  from '@nestjs/jwt';
import { ConfigService }          from '@nestjs/config';
import {
  UnauthorizedException, ForbiddenException,
  ConflictException, BadRequestException, NotFoundException,
} from '@nestjs/common';
import * as bcrypt                from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { AuthService }            from './auth.service';
import { LocalTokenProvider }     from './providers/local-token.provider';
import { TOKEN_PROVIDER }         from './providers/token-provider.interface';
import { PrismaService }          from '../../shared/prisma/prisma.service';
import { EmailService }           from '../../shared/services/email.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

const TENANT_ID   = 'tenant-aaa-111';
const USER_ID     = 'user-bbb-222';
const ROLE_ID     = 'role-ccc-333';
const IP          = '10.0.0.1';
const RAW_REFRESH = 'raw-refresh-token-abc123';
const REFRESH_HASH = sha256(RAW_REFRESH);

// ── Base user fixture ─────────────────────────────────────────────────────────

const baseUser = {
  id:               USER_ID,
  tenantId:         TENANT_ID,
  email:            'alice@factory.com',
  name:             'Alice',
  passwordHash:     '$2b$12$real',
  roles:            ['MERCHANDISER'],
  isActive:         true,
  isMfaEnabled:     false,
  isEmailVerified:  true,
  failedLoginCount: 0,
  lockedUntil:      null,
  lastLoginAt:      null,
  createdAt:        new Date(),
  updatedAt:        new Date(),
};

const baseTenant = {
  id:       TENANT_ID,
  name:     'Demo Co',
  slug:     'demo',
  plan:     'STARTER',
  status:   'ACTIVE',
  maxUsers: 5,
};

const baseRole = {
  id:          ROLE_ID,
  name:        'MERCHANDISER',
  tenantId:    null,
  permissions: ['buyers:read', 'orders:read'],
  isActive:    true,
  isSystem:    true,
};

const baseUserRole = {
  id:         'ur-111',
  userId:     USER_ID,
  roleId:     ROLE_ID,
  tenantId:   TENANT_ID,
  expiresAt:  null,
  role:       baseRole,
};

const storedRefreshToken = {
  id:        'rt-111',
  userId:    USER_ID,
  tenantId:  TENANT_ID,
  tokenHash: REFRESH_HASH,
  revokedAt: null,
  expiresAt: new Date(Date.now() + 7 * 86400_000),
  user:      baseUser,
};

// ── Mock Prisma ───────────────────────────────────────────────────────────────

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

const mockEmailService = {
  sendMfaOtp:        jest.fn().mockResolvedValue(undefined),
  sendPasswordReset: jest.fn().mockResolvedValue(undefined),
};

const mockConfig = {
  get: jest.fn((key: string, def?: string) => {
    const map: Record<string, string> = {
      JWT_SECRET:     'integration-test-secret',
      JWT_EXPIRES_IN: '15m',
      WEB_URL:        'http://localhost:3003',
    };
    return map[key] ?? def;
  }),
};

// ── Suite setup ───────────────────────────────────────────────────────────────

describe('Auth flow — full lifecycle integration', () => {
  let authService:  AuthService;
  let tokenProvider: LocalTokenProvider;
  let jwtService:   JwtService;

  beforeEach(async () => {
    // resetAllMocks clears implementations too (clearAllMocks only clears call counts).
    // This prevents the register-describe's $transaction mock from leaking into other flows.
    jest.resetAllMocks();
    // Default: userRole.findMany returns active role (needed by issueTokens)
    mockPrisma.userRole.findMany.mockResolvedValue([baseUserRole]);
    // Default: refreshToken.create succeeds
    mockPrisma.refreshToken.create.mockResolvedValue({});
    // Default: user.update (lastLoginAt + handleFailedLogin) succeeds
    mockPrisma.user.update.mockResolvedValue(baseUser);
    // Default: $transaction handles both callback form (register) and array form (resetPassword)
    mockPrisma.$transaction.mockImplementation(async (arg: any) => {
      if (typeof arg === 'function') return arg(mockPrisma);
      return Promise.all(arg);
    });
    // Restore bcrypt mocks (resetAllMocks clears their implementations)
    (bcrypt.hash    as jest.Mock).mockResolvedValue('$2b$12$hashed');
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);  // safe default; tests override as needed

    // Default: mockConfig.get needs to be reset since resetAllMocks cleared it
    mockConfig.get.mockImplementation((key: string, def?: string) => {
      const map: Record<string, string> = {
        JWT_SECRET:     'integration-test-secret',
        JWT_EXPIRES_IN: '15m',
        WEB_URL:        'http://localhost:3003',
      };
      return map[key] ?? def;
    });

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: 'integration-test-secret', signOptions: { expiresIn: '15m' } }),
      ],
      providers: [
        AuthService,
        LocalTokenProvider,
        { provide: PrismaService,  useValue: mockPrisma },
        { provide: ConfigService,  useValue: mockConfig },
        { provide: EmailService,   useValue: mockEmailService },
        { provide: TOKEN_PROVIDER, useClass: LocalTokenProvider },
      ],
    }).compile();

    authService   = module.get(AuthService);
    tokenProvider = module.get(LocalTokenProvider);
    jwtService    = module.get(JwtService);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // FLOW 1: register → login → GET /me → refresh → logout → stale token reuse
  // ══════════════════════════════════════════════════════════════════════════

  describe('Flow 1 — register → login → refresh → logout', () => {

    // ── Step 1: Register ────────────────────────────────────────────────────
    describe('register', () => {
      const registerDto = {
        tenantId: TENANT_ID,
        email:    'newuser@factory.com',
        name:     'New User',
        password: 'SecurePass123!',
        roles:    ['MERCHANDISER'],
      };

      beforeEach(() => {
        mockPrisma.tenant.findUnique.mockResolvedValue(baseTenant);
        mockPrisma.user.count.mockResolvedValue(2);          // 2 of 5 slots used
        mockPrisma.user.findFirst.mockResolvedValue(null);    // email not taken
        mockPrisma.role.findMany.mockResolvedValue([baseRole]);
        const newUser = { ...baseUser, id: 'user-new-444', email: registerDto.email };
        // Override $transaction for register: callback form with in-tx create mocks
        mockPrisma.$transaction.mockImplementation(async (arg: any) => {
          if (typeof arg === 'function') {
            const txAny = {
              user:     { create: jest.fn().mockResolvedValue(newUser) },
              userRole: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
            };
            return arg(txAny);
          }
          return Promise.all(arg);
        });
        mockPrisma.otpCode.create.mockResolvedValue({});
      });

      it('creates user and sends verification OTP', async () => {
        const result = await authService.register(registerDto);

        expect(result.userId).toBeDefined();
        expect(result.message).toMatch(/verify/i);
        expect(mockEmailService.sendMfaOtp).toHaveBeenCalledWith(
          expect.objectContaining({ to: registerDto.email }),
        );
      });

      it('rejects duplicate email in same tenant', async () => {
        mockPrisma.user.findFirst.mockResolvedValue(baseUser);
        await expect(authService.register(registerDto))
          .rejects.toThrow(ConflictException);
      });

      it('rejects when tenant user limit is reached', async () => {
        mockPrisma.user.count.mockResolvedValue(5); // plan maxUsers = 5
        await expect(authService.register(registerDto))
          .rejects.toThrow(ForbiddenException);
      });

      it('rejects when tenant does not exist', async () => {
        mockPrisma.tenant.findUnique.mockResolvedValue(null);
        await expect(authService.register(registerDto))
          .rejects.toThrow(NotFoundException);
      });
    });

    // ── Step 2: Login (MFA disabled) ────────────────────────────────────────
    describe('login — no MFA', () => {
      const loginDto = { email: 'alice@factory.com', password: 'SecurePass123!' };

      beforeEach(() => {
        mockPrisma.user.findFirst.mockResolvedValue({ ...baseUser, isMfaEnabled: false });
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      });

      it('returns access + refresh tokens immediately', async () => {
        const result = await authService.login(loginDto, IP) as any;

        expect(result.requiresMfa).toBe(false);
        expect(result.accessToken).toBeDefined();
        expect(result.refreshToken).toBeDefined();
        expect(result.expiresIn).toBeGreaterThan(0);
        expect(result.user.email).toBe(loginDto.email);
        expect(result.user.roles).toContain('MERCHANDISER');
        expect(result.user.permissions).toContain('buyers:read');
      });

      it('access token has correct JWT claims', async () => {
        const result = await authService.login(loginDto, IP) as any;
        const decoded = jwtService.decode(result.accessToken) as any;

        expect(decoded.sub).toBe(USER_ID);
        expect(decoded.tenantId).toBe(TENANT_ID);
        expect(decoded.roles).toContain('MERCHANDISER');
        expect(decoded.permissions).toContain('buyers:read');
        expect(decoded.type).toBe('access');
      });

      it('resets failed login counter on success', async () => {
        await authService.login(loginDto, IP);
        expect(mockPrisma.user.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ failedLoginCount: 0, lockedUntil: null }),
          }),
        );
      });

      it('rejects wrong password and increments failed count', async () => {
        (bcrypt.compare as jest.Mock).mockResolvedValue(false);
        // handleFailedLogin does findUnique then stores newCount as a plain number
        mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, failedLoginCount: 0 });
        mockPrisma.user.update.mockResolvedValue({});

        await expect(authService.login(loginDto, IP))
          .rejects.toThrow(UnauthorizedException);

        expect(mockPrisma.user.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ failedLoginCount: 1 }),
          }),
        );
      });

      it('rejects unknown email', async () => {
        mockPrisma.user.findFirst.mockResolvedValue(null);
        (bcrypt.compare as jest.Mock).mockResolvedValue(false);
        await expect(authService.login(loginDto, IP))
          .rejects.toThrow(UnauthorizedException);
      });

      it('rejects deactivated account', async () => {
        mockPrisma.user.findFirst.mockResolvedValue({ ...baseUser, isActive: false });
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);
        await expect(authService.login(loginDto, IP))
          .rejects.toThrow(ForbiddenException);
      });

      it('rejects locked account and shows minutes remaining', async () => {
        mockPrisma.user.findFirst.mockResolvedValue({
          ...baseUser,
          lockedUntil: new Date(Date.now() + 10 * 60_000), // locked 10 min
        });
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);
        const err = await authService.login(loginDto, IP).catch(e => e);
        expect(err).toBeInstanceOf(ForbiddenException);
        expect(err.message).toMatch(/locked/i);
      });

      it('locks account after 5 failed attempts', async () => {
        mockPrisma.user.findFirst.mockResolvedValue({
          ...baseUser,
          failedLoginCount: 4, // one more will lock
          lockedUntil: null,
        });
        (bcrypt.compare as jest.Mock).mockResolvedValue(false);
        // handleFailedLogin calls findUnique to get current count
        mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, failedLoginCount: 4 });
        mockPrisma.user.update.mockResolvedValue({});

        await expect(authService.login(loginDto, IP)).rejects.toThrow(UnauthorizedException);

        // newCount = 5 >= MAX_LOGIN_ATTEMPTS → lockedUntil set
        expect(mockPrisma.user.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ failedLoginCount: 5, lockedUntil: expect.any(Date) }),
          }),
        );
      });
    });

    // ── Step 3: JWT is valid for /me ────────────────────────────────────────
    describe('getProfile — JWT access', () => {
      it('returns merged profile + permissions', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(baseUser);
        mockPrisma.userRole.findMany.mockResolvedValue([baseUserRole]);

        const profile = await authService.getProfile(USER_ID);

        expect(profile.id).toBe(USER_ID);
        expect(profile.email).toBe(baseUser.email);
        expect(profile.roles).toContain('MERCHANDISER');
        expect(profile.permissions).toContain('buyers:read');
      });

      it('throws NotFoundException for unknown user', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);
        await expect(authService.getProfile('ghost-id'))
          .rejects.toThrow(NotFoundException);
      });
    });

    // ── Step 4: Refresh tokens (rotation) ───────────────────────────────────
    describe('refresh — token rotation', () => {
      it('issues new access + refresh tokens and revokes old refresh token', async () => {
        mockPrisma.refreshToken.findFirst.mockResolvedValue(storedRefreshToken);
        mockPrisma.refreshToken.update.mockResolvedValue({});   // revoke old
        mockPrisma.refreshToken.create.mockResolvedValue({});   // store new

        const result = await authService.refreshToken({ refreshToken: RAW_REFRESH }, IP) as any;

        // New tokens issued
        expect(result.accessToken).toBeDefined();
        expect(result.refreshToken).toBeDefined();

        // Old token revoked
        expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: storedRefreshToken.id },
            data:  { revokedAt: expect.any(Date) },
          }),
        );

        // New refresh token stored
        expect(mockPrisma.refreshToken.create).toHaveBeenCalled();
      });

      it('new refresh token is different from the consumed one (rotation)', async () => {
        mockPrisma.refreshToken.findFirst.mockResolvedValue(storedRefreshToken);
        mockPrisma.refreshToken.update.mockResolvedValue({});
        let storedNewHash: string | undefined;
        mockPrisma.refreshToken.create.mockImplementation(async ({ data }: any) => {
          storedNewHash = data.tokenHash;
          return {};
        });

        const result = await authService.refreshToken({ refreshToken: RAW_REFRESH }, IP) as any;

        // New raw token ≠ old raw token
        expect(result.refreshToken).not.toBe(RAW_REFRESH);
        // DB hash of new token ≠ hash of old token
        expect(storedNewHash).not.toBe(REFRESH_HASH);
      });

      it('rejects expired refresh token', async () => {
        mockPrisma.refreshToken.findFirst.mockResolvedValue(null); // expired = not found
        await expect(authService.refreshToken({ refreshToken: 'bad-token' }, IP))
          .rejects.toThrow(UnauthorizedException);
      });

      it('rejects already-revoked refresh token', async () => {
        mockPrisma.refreshToken.findFirst.mockResolvedValue(null); // revokedAt set = filtered out
        await expect(authService.refreshToken({ refreshToken: RAW_REFRESH }, IP))
          .rejects.toThrow(UnauthorizedException);
      });

      it('rejects refresh token for inactive user', async () => {
        mockPrisma.refreshToken.findFirst.mockResolvedValue({
          ...storedRefreshToken,
          user: { ...baseUser, isActive: false },
        });
        await expect(authService.refreshToken({ refreshToken: RAW_REFRESH }, IP))
          .rejects.toThrow(UnauthorizedException);
      });
    });

    // ── Step 5: Logout (single device) ──────────────────────────────────────
    describe('logout — single device', () => {
      it('revokes the specific refresh token', async () => {
        mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

        const result = await authService.logout(USER_ID, RAW_REFRESH);

        expect(result.message).toMatch(/logged out/i);
        expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { userId: USER_ID, tokenHash: REFRESH_HASH, revokedAt: null },
            data:  { revokedAt: expect.any(Date) },
          }),
        );
      });

      it('revoked token cannot be used to refresh', async () => {
        // After logout, findFirst returns null (token is revoked)
        mockPrisma.refreshToken.findFirst.mockResolvedValue(null);
        await expect(authService.refreshToken({ refreshToken: RAW_REFRESH }, IP))
          .rejects.toThrow(UnauthorizedException);
      });
    });

    // ── Step 6: Logout all devices ───────────────────────────────────────────
    describe('logoutAll — all devices', () => {
      it('revokes every active refresh token for the user', async () => {
        mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

        const result = await authService.logoutAll(USER_ID);

        expect(result.message).toMatch(/all devices/i);
        expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { userId: USER_ID, revokedAt: null },
            data:  { revokedAt: expect.any(Date) },
          }),
        );
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // FLOW 2: Login with MFA → OTP gate → full tokens
  // ══════════════════════════════════════════════════════════════════════════

  describe('Flow 2 — login with MFA → verify-otp', () => {
    const loginDto = { email: 'alice@factory.com', password: 'SecurePass123!' };
    const OTP_CODE = '123456';
    const otpHash  = createHash('sha256').update(OTP_CODE).digest('hex');

    beforeEach(() => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...baseUser, isMfaEnabled: true });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrisma.user.update.mockResolvedValue(baseUser);
      mockPrisma.otpCode.create.mockResolvedValue({});
    });

    it('login returns tempToken (not access token) when MFA enabled', async () => {
      const result = await authService.login(loginDto, IP) as any;

      expect(result.requiresMfa).toBe(true);
      expect(result.tempToken).toBeDefined();
      expect(result.accessToken).toBeUndefined();
      expect(result.refreshToken).toBeUndefined();
      expect(mockEmailService.sendMfaOtp).toHaveBeenCalled();
    });

    it('verify-otp exchanges tempToken + correct OTP for full tokens', async () => {
      const loginResult = await authService.login(loginDto, IP) as any;
      const tempToken   = loginResult.tempToken;

      mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, isMfaEnabled: true });
      mockPrisma.otpCode.findFirst.mockResolvedValue({
        id:        'otp-111',
        userId:    USER_ID,
        type:      'MFA_LOGIN',
        code:      otpHash,
        attempts:  0,
        usedAt:    null,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      });
      mockPrisma.otpCode.update.mockResolvedValue({});

      const result = await authService.verifyOtp({ tempToken, otp: OTP_CODE }, IP) as any;

      expect(result.requiresMfa).toBe(false);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      // OTP marked as used
      expect(mockPrisma.otpCode.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { usedAt: expect.any(Date) } }),
      );
    });

    it('verify-otp rejects wrong OTP and decrements remaining attempts', async () => {
      const loginResult = await authService.login(loginDto, IP) as any;

      mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, isMfaEnabled: true });
      mockPrisma.otpCode.findFirst.mockResolvedValue({
        id:        'otp-111',
        userId:    USER_ID,
        type:      'MFA_LOGIN',
        code:      otpHash,        // correct hash — but we send wrong OTP below
        attempts:  0,
        usedAt:    null,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      });
      mockPrisma.otpCode.update.mockResolvedValue({});

      await expect(
        authService.verifyOtp({ tempToken: loginResult.tempToken, otp: '000000' }, IP),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.otpCode.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { attempts: { increment: 1 } } }),
      );
    });

    it('verify-otp rejects after 5 failed attempts (brute-force protection)', async () => {
      const loginResult = await authService.login(loginDto, IP) as any;

      mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, isMfaEnabled: true });
      mockPrisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-111', userId: USER_ID, type: 'MFA_LOGIN',
        code: otpHash, attempts: 5,  // already maxed
        usedAt: null, expiresAt: new Date(Date.now() + 10 * 60_000),
      });

      await expect(
        authService.verifyOtp({ tempToken: loginResult.tempToken, otp: OTP_CODE }, IP),
      ).rejects.toThrow(ForbiddenException);
    });

    it('verify-otp rejects expired OTP', async () => {
      const loginResult = await authService.login(loginDto, IP) as any;

      mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, isMfaEnabled: true });
      mockPrisma.otpCode.findFirst.mockResolvedValue(null); // expired = not found

      await expect(
        authService.verifyOtp({ tempToken: loginResult.tempToken, otp: OTP_CODE }, IP),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('verify-otp rejects tampered tempToken', async () => {
      await expect(
        authService.verifyOtp({ tempToken: 'invalid.jwt.token', otp: OTP_CODE }, IP),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('verify-otp rejects access token used as tempToken', async () => {
      // First do a non-MFA login to get a real access token
      mockPrisma.user.findFirst.mockResolvedValue({ ...baseUser, isMfaEnabled: false });
      const nonMfaResult = await authService.login(loginDto, IP) as any;
      const accessToken  = nonMfaResult.accessToken;

      await expect(
        authService.verifyOtp({ tempToken: accessToken, otp: OTP_CODE }, IP),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // FLOW 3: Forgot password → reset password
  // ══════════════════════════════════════════════════════════════════════════

  describe('Flow 3 — forgot-password → reset-password', () => {
    const forgotDto = { email: 'alice@factory.com' };

    it('sends reset email and returns generic message', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(baseUser);
      mockPrisma.passwordReset.create.mockResolvedValue({});

      const result = await authService.forgotPassword(forgotDto);

      expect(result.message).toMatch(/reset link/i);
      expect(mockEmailService.sendPasswordReset).toHaveBeenCalledWith(
        expect.objectContaining({ to: baseUser.email }),
      );
      // Check reset URL contains token
      const callArg = (mockEmailService.sendPasswordReset as jest.Mock).mock.calls[0][0];
      expect(callArg.resetUrl).toContain('/auth/reset-password?token=');
    });

    it('returns same generic message for unknown email (no enumeration)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const result = await authService.forgotPassword({ email: 'ghost@nowhere.com' });

      expect(result.message).toMatch(/reset link/i);
      expect(mockEmailService.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('resets password with valid token and re-hashes', async () => {
      const rawToken   = 'valid-reset-token-xyz';
      const tokenHash  = sha256(rawToken);

      mockPrisma.passwordReset.findFirst.mockResolvedValue({
        id:        'pr-111',
        userId:    USER_ID,
        tenantId:  TENANT_ID,
        tokenHash,
        usedAt:    null,
        expiresAt: new Date(Date.now() + 15 * 60_000),
        user:      baseUser,
      });
      mockPrisma.passwordReset.update.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});

      const result = await authService.resetPassword({
        token:       rawToken,
        newPassword: 'NewSecure456!',
      });

      expect(result.message).toMatch(/password/i);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ passwordHash: '$2b$12$hashed' }),
        }),
      );
      expect(mockPrisma.passwordReset.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { usedAt: expect.any(Date) } }),
      );
    });

    it('rejects expired reset token', async () => {
      mockPrisma.passwordReset.findFirst.mockResolvedValue(null);
      await expect(
        authService.resetPassword({ token: 'expired-token', newPassword: 'NewPass123!' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // FLOW 4: change-password (authenticated)
  // ══════════════════════════════════════════════════════════════════════════

  describe('Flow 4 — change-password (authenticated)', () => {
    it('changes password when current password is correct', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrisma.user.update.mockResolvedValue({});

      const result = await authService.changePassword(USER_ID, {
        currentPassword: 'OldPass123!',
        newPassword:     'NewPass456!',
      });

      expect(result.message).toMatch(/password/i);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ passwordHash: '$2b$12$hashed' }),
        }),
      );
    });

    it('rejects wrong current password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        authService.changePassword(USER_ID, {
          currentPassword: 'WrongOldPass!',
          newPassword:     'NewPass456!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        authService.changePassword('bad-id', {
          currentPassword: 'any',
          newPassword:     'NewPass456!',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // FLOW 5: Token security edge cases
  // ══════════════════════════════════════════════════════════════════════════

  describe('Flow 5 — token security edge cases', () => {
    const loginDto = { email: 'alice@factory.com', password: 'SecurePass123!' };

    beforeEach(() => {
      mockPrisma.user.findFirst.mockResolvedValue(baseUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    });

    it('refresh token is stored as SHA-256 hash (raw token never saved)', async () => {
      let savedTokenHash: string | undefined;
      mockPrisma.refreshToken.create.mockImplementation(async ({ data }: any) => {
        savedTokenHash = data.tokenHash;
        return {};
      });

      const result = await authService.login(loginDto, IP) as any;
      const rawRefresh = result.refreshToken;

      // DB stores hash, not raw value
      expect(savedTokenHash).toBe(sha256(rawRefresh));
      expect(savedTokenHash).not.toBe(rawRefresh);
    });

    it('IP address is stored with refresh token for anomaly detection', async () => {
      await authService.login(loginDto, IP);

      expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ipAddress: IP }),
        }),
      );
    });

    it('refresh token has 7-day expiry', async () => {
      let storedExpiresAt: Date | undefined;
      mockPrisma.refreshToken.create.mockImplementation(async ({ data }: any) => {
        storedExpiresAt = data.expiresAt;
        return {};
      });

      await authService.login(loginDto, IP);

      const diffDays = (storedExpiresAt!.getTime() - Date.now()) / 86400_000;
      expect(diffDays).toBeCloseTo(7, 0);
    });

    it('permissions in JWT match live UserRole data', async () => {
      const result = await authService.login(loginDto, IP) as any;
      const decoded = jwtService.decode(result.accessToken) as any;

      expect(decoded.permissions).toEqual(
        expect.arrayContaining(baseRole.permissions),
      );
    });

    it('falls back to user.roles[] when no UserRole rows exist', async () => {
      mockPrisma.userRole.findMany.mockResolvedValue([]); // no UserRole rows
      mockPrisma.user.findFirst.mockResolvedValue({
        ...baseUser,
        roles: ['CUSTOM_ROLE'],
      });

      const result = await authService.login(loginDto, IP) as any;
      expect(result.user.roles).toContain('CUSTOM_ROLE');
    });
  });
});
