// src/shared/guards/tenant.guard.ts
import {
  Injectable, CanActivate, ExecutionContext,
  UnauthorizedException, Logger,
} from '@nestjs/common';
import { tenantStorage } from '../prisma/prisma.service';

// ── TenantGuard ────────────────────────────────────────────────────────────
// Extracts tenantId from the JWT payload (set by JwtStrategy.validate)
// and stores it in AsyncLocalStorage so it propagates through the entire
// async call chain for this request.
//
// PrismaService's middleware reads this and calls:
//   SET LOCAL app.tenant_id = '<tenantId>'
// before every Prisma query, activating PostgreSQL Row Level Security.
//
// ORDER: JwtAuthGuard must run BEFORE TenantGuard.
// Apply both with: @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)

@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request  = context.switchToHttp().getRequest();
    const tenantId = request.user?.tenantId;

    if (!tenantId) {
      this.logger.warn(`Request rejected: no tenantId in JWT payload`);
      throw new UnauthorizedException(
        'No tenant context found. Ensure your token includes a tenantId claim.'
      );
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenantId)) {
      this.logger.warn(`Invalid tenantId format: ${tenantId}`);
      throw new UnauthorizedException('Invalid tenant context.');
    }

    // enterWith() sets the store for the duration of this async context.
    // All code in the same request (service calls, repo calls, Prisma queries)
    // will see this context when they call tenantStorage.getStore().
    //
    // userId and role are also forwarded so PrismaService can set:
    //   app.current_user_id   — enables user self-access RLS policies
    //   app.current_role      — enables OWNER-bypass RLS policies
    const userId = request.user?.id ?? request.user?.sub;
    const role   = request.user?.roles?.[0] ?? '';   // highest role in JWT

    tenantStorage.enterWith({ tenantId, userId, role });

    this.logger.debug(`Tenant context set: ${tenantId} user=${userId} role=${role}`);
    return true;
  }
}
