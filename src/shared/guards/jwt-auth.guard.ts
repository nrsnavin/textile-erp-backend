// src/shared/guards/jwt-auth.guard.ts
import {
  Injectable, ExecutionContext, UnauthorizedException, Logger,
} from '@nestjs/common';
import { AuthGuard }  from '@nestjs/passport';
import { Reflector }  from '@nestjs/core';

// ── Decorator to mark routes as public (no JWT required) ─────────────────
export const IS_PUBLIC_KEY = 'isPublic';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Check if the route is marked @Public() — skip JWT check if so
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    return super.canActivate(context);
  }

  // Called after Passport validates the JWT
  handleRequest(err: any, user: any, info: any) {
    if (err) {
      this.logger.warn(`JWT auth error: ${err.message}`);
      throw err;
    }

    if (!user) {
      const reason = info?.message ?? 'No token provided';
      this.logger.debug(`JWT auth failed: ${reason}`);
      throw new UnauthorizedException(
        reason === 'jwt expired'
          ? 'Your session has expired. Please log in again.'
          : 'Authentication required. Please log in.'
      );
    }

    return user;
  }
}
