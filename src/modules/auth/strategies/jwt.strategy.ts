// src/modules/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy }                  from '@nestjs/passport';
import { ExtractJwt, Strategy }              from 'passport-jwt';
import { ConfigService }                     from '@nestjs/config';
import { PrismaService }                     from '../../../shared/prisma/prisma.service';

export interface JwtPayload {
  sub:         string;    // userId
  email:       string;
  tenantId:    string;
  roles:       string[];  // denormalised role names, e.g. ["OWNER"]
  permissions: string[];  // merged permission set, e.g. ["buyers:read","orders:confirm"]
  type:        'access' | 'temp'; // temp = awaiting MFA
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly config:  ConfigService,
    private readonly prisma:  PrismaService,
  ) {
    super({
      jwtFromRequest:   ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:      config.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    // Reject temp tokens on protected routes
    if (payload.type === 'temp') {
      throw new UnauthorizedException('MFA verification required');
    }

    // Verify user still exists, is active, and fetch live role/permission data.
    // We include userRoles so the JWT cache can be validated against the DB state.
    const user = await this.prisma.user.findUnique({
      where:  { id: payload.sub },
      select: {
        id:       true,
        isActive: true,
        tenantId: true,
        roles:    true,           // denormalised cache (String[])
        userRoles: {
          where:  {
            // Exclude expired assignments
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } },
            ],
          },
          include: {
            role: {
              select: { name: true, permissions: true, isActive: true },
            },
          },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User account is inactive or not found');
    }

    // Derive live roles and merged permissions from UserRole relations.
    // If no UserRole rows exist yet (legacy / seed), fall back to the
    // denormalised roles[] column so existing accounts keep working.
    const liveRoles = user.userRoles
      .filter(ur => ur.role.isActive)
      .map(ur => ur.role.name);

    const effectiveRoles = liveRoles.length > 0 ? liveRoles : user.roles;

    const permissions = Array.from(
      new Set(
        user.userRoles
          .filter(ur => ur.role.isActive)
          .flatMap(ur => ur.role.permissions),
      ),
    );

    return {
      sub:         payload.sub,
      email:       payload.email,
      tenantId:    payload.tenantId,
      roles:       effectiveRoles,
      permissions,
    };
  }
}
