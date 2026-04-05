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

    // Verify user still exists and is active.
    // userRoles is queried separately (cast to any) because the Prisma client
    // was generated before the UserRole model was added to the schema.
    // Run prisma generate after the next migration to remove these casts.
    const user = await this.prisma.user.findUnique({
      where:  { id: payload.sub },
      select: {
        id:       true,
        isActive: true,
        tenantId: true,
        roles:    true,   // denormalised cache (String[])
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User account is inactive or not found');
    }

    // Load live UserRole → Role data separately (new model, not yet in generated client)
    const prismaAny  = this.prisma as any;
    const userRoles: any[] = await prismaAny.userRole.findMany({
      where: {
        userId: payload.sub,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: { role: { select: { name: true, permissions: true, isActive: true } } },
    }).catch(() => []);   // graceful degradation if table doesn't exist yet

    // Derive live roles and merged permissions from UserRole relations.
    // Falls back to the denormalised roles[] column so existing accounts keep working.
    const activeUserRoles = userRoles.filter((ur: any) => ur.role.isActive);
    const liveRoles       = activeUserRoles.map((ur: any) => ur.role.name as string);
    const effectiveRoles  = liveRoles.length > 0 ? liveRoles : user.roles;

    const permissions = Array.from(
      new Set(activeUserRoles.flatMap((ur: any) => ur.role.permissions as string[])),
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
