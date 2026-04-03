// src/shared/decorators/permissions.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Require all listed permission strings to be present in the user's JWT.
 *
 * Usage:
 *   @RequirePermissions('invoices:approve', 'reports:export')
 *
 * Can be combined with @Roles() — both checks must pass.
 * OWNER always bypasses permission checks.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
