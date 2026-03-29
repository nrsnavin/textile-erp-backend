// src/shared/decorators/roles.decorator.ts
import { SetMetadata }    from '@nestjs/common';
import { Role }           from '../guards/roles.guard';

export const ROLES_KEY = 'roles';

// ── @Roles(...roles) ───────────────────────────────────────────────────────
// Declares which roles can access a route.
//
// Usage:
//   @Roles(Role.OWNER, Role.MERCHANDISER)
//   @Roles(Role.ACCOUNTANT)
//
// If omitted → any authenticated user can access the route.

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
