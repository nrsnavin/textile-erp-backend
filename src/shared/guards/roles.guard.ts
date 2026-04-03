// src/shared/guards/roles.guard.ts
import {
  Injectable, CanActivate, ExecutionContext,
  ForbiddenException, Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY }       from '../decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

// ── Role definitions ───────────────────────────────────────────────────────
// These names must match the `name` column in the system roles seeded by
// migration 20260402100000_add_tenant_role_config.
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

// ── Permission constants ───────────────────────────────────────────────────
// Mirrors the permissions seeded into the roles table.
// Use these with the @RequirePermissions() decorator for fine-grained checks.
export const Permission = {
  // Buyers
  BUYERS_READ:    'buyers:read',
  BUYERS_WRITE:   'buyers:write',
  BUYERS_DELETE:  'buyers:delete',
  // Suppliers
  SUPPLIERS_READ:  'suppliers:read',
  SUPPLIERS_WRITE: 'suppliers:write',
  // Orders
  ORDERS_READ:    'orders:read',
  ORDERS_CONFIRM: 'orders:confirm',
  ORDERS_CANCEL:  'orders:cancel',
  ORDERS_REVISE:  'orders:revise',
  // Invoices
  INVOICES_READ:    'invoices:read',
  INVOICES_CREATE:  'invoices:create',
  INVOICES_APPROVE: 'invoices:approve',
  INVOICES_VOID:    'invoices:void',
  // Reports
  REPORTS_READ:   'reports:read',
  REPORTS_EXPORT: 'reports:export',
  // Settings
  SETTINGS_READ:  'settings:read',
  SETTINGS_WRITE: 'settings:write',
  // Users
  USERS_READ:         'users:read',
  USERS_WRITE:        'users:write',
  USERS_ASSIGN_ROLES: 'users:assign-roles',
  // Audit
  AUDIT_READ: 'audit:read',
} as const;

export type PermissionString = typeof Permission[keyof typeof Permission];

// ── RolesGuard ─────────────────────────────────────────────────────────────
// Checks:
//   1. @Roles(Role.OWNER, Role.MERCHANDISER)  → role-name check (coarse)
//   2. @RequirePermissions('buyers:write')     → permission check (fine-grained)
//
// Both decorators can be used together — the guard requires ALL permission
// strings AND at least one role match to pass.
//
// ORDER: Always run after JwtAuthGuard and TenantGuard.
// Apply with @ApiAuth(...roles) which bundles all three guards.

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No restrictions declared → any authenticated user can access
    if (
      (!requiredRoles || requiredRoles.length === 0) &&
      (!requiredPermissions || requiredPermissions.length === 0)
    ) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user?.roles || !Array.isArray(user.roles)) {
      this.logger.warn(`No roles in JWT payload for user: ${user?.sub}`);
      throw new ForbiddenException('No roles assigned to your account.');
    }

    // OWNER always passes — unrestricted super-admin
    if (user.roles.includes(Role.OWNER)) return true;

    // ── Role check ─────────────────────────────────────────────────────────
    if (requiredRoles && requiredRoles.length > 0) {
      const hasRole = requiredRoles.some(r => user.roles.includes(r));

      if (!hasRole) {
        this.logger.warn(
          `Access denied for user ${user.sub} ` +
          `(roles: ${user.roles.join(',')}) — required: ${requiredRoles.join(' | ')}`,
        );
        throw new ForbiddenException(
          `You do not have permission to perform this action. ` +
          `Required role: ${requiredRoles.join(' or ')}.`,
        );
      }
    }

    // ── Permission check ───────────────────────────────────────────────────
    if (requiredPermissions && requiredPermissions.length > 0) {
      const userPerms: string[] = user.permissions ?? [];
      const missingPerms = requiredPermissions.filter(p => !userPerms.includes(p));

      if (missingPerms.length > 0) {
        this.logger.warn(
          `Permission denied for user ${user.sub} ` +
          `— missing: ${missingPerms.join(', ')}`,
        );
        throw new ForbiddenException(
          `Missing required permissions: ${missingPerms.join(', ')}.`,
        );
      }
    }

    return true;
  }
}
