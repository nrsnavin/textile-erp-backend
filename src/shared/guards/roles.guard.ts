// src/shared/guards/roles.guard.ts
import {
  Injectable, CanActivate, ExecutionContext,
  ForbiddenException, Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

// ── Role definitions ───────────────────────────────────────────────────────
export enum Role {
  OWNER          = 'OWNER',
  MERCHANDISER   = 'MERCHANDISER',
  PRODUCTION_MGR = 'PRODUCTION_MGR',
  STORE_MANAGER  = 'STORE_MANAGER',
  SUPERVISOR     = 'SUPERVISOR',
  QC_INSPECTOR   = 'QC_INSPECTOR',
  ACCOUNTANT     = 'ACCOUNTANT',
  BUYER          = 'BUYER',       // external — read own orders only
  SUPPLIER       = 'SUPPLIER',    // external — read own POs only
}

// ── RolesGuard ─────────────────────────────────────────────────────────────
// Checks the @Roles() decorator on the route handler against the user's
// roles array extracted from the JWT by JwtStrategy.
//
// Usage:
//   @Roles(Role.OWNER, Role.MERCHANDISER)    → allow these roles
//   @Roles()                                 → allow any authenticated user
//   No @Roles() decorator                    → allow any authenticated user
//
// ORDER: Always run after JwtAuthGuard and TenantGuard.
// Apply with: @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Get the roles required by the @Roles() decorator
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() decorator → any authenticated user can access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user?.roles || !Array.isArray(user.roles)) {
      this.logger.warn(`No roles in JWT payload for user: ${user?.sub}`);
      throw new ForbiddenException('No roles assigned to your account.');
    }

    // OWNER always passes — super admin
    if (user.roles.includes(Role.OWNER)) return true;

    const hasRole = requiredRoles.some(role => user.roles.includes(role));

    if (!hasRole) {
      this.logger.warn(
        `Access denied for user ${user.sub} (roles: ${user.roles.join(',')}) ` +
        `— required: ${requiredRoles.join(' | ')}`
      );
      throw new ForbiddenException(
        `You do not have permission to perform this action. ` +
        `Required role: ${requiredRoles.join(' or ')}.`
      );
    }

    return true;
  }
}
