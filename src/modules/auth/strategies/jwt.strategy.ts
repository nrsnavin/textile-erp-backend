// src/modules/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy }                  from '@nestjs/passport';
import { ExtractJwt, Strategy }              from 'passport-jwt';
import { ConfigService }                     from '@nestjs/config';
import { PrismaService }                     from '../../../shared/prisma/prisma.service';

export interface JwtPayload {
  sub:      string;   // userId
  email:    string;
  tenantId: string;
  roles:    string[];
  type:     'access' | 'temp'; // temp = awaiting MFA
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
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

    // Verify user still exists and is active
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, isActive: true, tenantId: true, roles: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User account is inactive or not found');
    }

    return {
      sub:      payload.sub,
      email:    payload.email,
      tenantId: payload.tenantId,
      roles:    payload.roles,
    };
  }
}
