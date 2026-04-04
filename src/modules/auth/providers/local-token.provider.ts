// src/modules/auth/providers/local-token.provider.ts
//
// Implements ITokenProvider using JWTs signed by this application and
// refresh tokens stored (as SHA-256 hashes) in the `refresh_tokens` table.
//
// Token characteristics:
//   Access token  — short-lived (15 min default), signed HS256, stateless
//   Refresh token — long-lived (7 days), opaque random bytes, DB-backed for
//                   revocation support and rotation enforcement
//
// Security properties:
//   • Refresh token rotation: consuming a token immediately revokes it and
//     issues a new one — stolen tokens are single-use.
//   • Permissions embedded in JWT from live UserRole data so RolesGuard
//     never needs a DB query on the hot-path.
//   • IP address stored with refresh tokens for anomaly detection.

import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService }    from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  ITokenProvider, TokenResponse, UserSummary, TOKEN_PROVIDER,
} from './token-provider.interface';

const REFRESH_EXPIRY_DAYS = 7;

@Injectable()
export class LocalTokenProvider implements ITokenProvider {
  readonly providerName = 'local';
  private readonly logger = new Logger(LocalTokenProvider.name);

  constructor(
    private readonly prisma:  PrismaService,
    private readonly jwt:     JwtService,
    private readonly config:  ConfigService,
  ) {}

  // ── issueTokens ────────────────────────────────────────────────────────

  async issueTokens(user: any, ip?: string): Promise<TokenResponse> {
    // Load live roles + permissions from UserRole → Role relations.
    // Falls back to user.roles[] (denormalised cache) if no UserRole rows
    // exist yet (e.g. legacy seed accounts or just-registered users whose
    // UserRole rows are created in the same transaction).
    const prismaAny = this.prisma as any;
    const userRoles: any[] = await prismaAny.userRole.findMany({
      where:   {
        userId: user.id,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: { role: { select: { name: true, permissions: true, isActive: true } } },
    });

    const activeUserRoles = userRoles.filter((ur: any) => ur.role.isActive);

    const roles: string[] = activeUserRoles.length > 0
      ? activeUserRoles.map((ur: any) => ur.role.name)
      : (user.roles ?? []);

    const permissions: string[] = Array.from(
      new Set(activeUserRoles.flatMap((ur: any) => ur.role.permissions as string[])),
    );

    const payload = {
      sub:         user.id,
      email:       user.email,
      tenantId:    user.tenantId,
      roles,
      permissions,
      type:        'access' as const,
    };

    const expiresIn = this.accessTokenTtlSeconds();

    const accessToken = this.jwt.sign(payload, {
      secret:    this.config.get('JWT_SECRET'),
      expiresIn: this.config.get('JWT_EXPIRES_IN', '15m'),
    });

    const { rawRefresh, expiresAt } = await this.createRefreshToken(user.id, user.tenantId, ip);

    await this.prisma.user.update({
      where: { id: user.id },
      data:  { lastLoginAt: new Date() },
    });

    return {
      requiresMfa:  false,
      accessToken,
      refreshToken: rawRefresh,
      expiresIn,
      user: this.toSummary(user, roles, permissions),
    };
  }

  // ── refreshTokens ──────────────────────────────────────────────────────

  async refreshTokens(rawRefreshToken: string, ip?: string): Promise<TokenResponse> {
    const tokenHash = this.hash(rawRefreshToken);

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

    // Rotate: revoke consumed token immediately
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data:  { revokedAt: new Date() },
    });

    return this.issueTokens(stored.user, ip);
  }

  // ── revokeTokens ───────────────────────────────────────────────────────

  async revokeTokens(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      const tokenHash = this.hash(refreshToken);
      await this.prisma.refreshToken.updateMany({
        where: { userId, tokenHash, revokedAt: null },
        data:  { revokedAt: new Date() },
      });
    } else {
      // Logout-all: revoke every active refresh token for this user
      const count = await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data:  { revokedAt: new Date() },
      });
      this.logger.log(`Revoked ${count.count} refresh token(s) for user ${userId}`);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private async createRefreshToken(userId: string, tenantId: string, ip?: string) {
    const rawRefresh = randomBytes(40).toString('hex');
    const tokenHash  = this.hash(rawRefresh);
    const expiresAt  = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_EXPIRY_DAYS);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tenantId,
        tokenHash,
        expiresAt,
        ipAddress: ip,
      },
    });

    return { rawRefresh, expiresAt };
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private accessTokenTtlSeconds(): number {
    const raw = this.config.get<string>('JWT_EXPIRES_IN', '15m');
    if (raw.endsWith('m')) return parseInt(raw) * 60;
    if (raw.endsWith('h')) return parseInt(raw) * 3600;
    if (raw.endsWith('s')) return parseInt(raw);
    return 900; // default 15 minutes
  }

  private toSummary(user: any, roles: string[], permissions: string[]): UserSummary {
    return {
      id:           user.id,
      email:        user.email,
      name:         user.name,
      roles,
      permissions,
      tenantId:     user.tenantId,
      isMfaEnabled: user.isMfaEnabled ?? false,
    };
  }
}
