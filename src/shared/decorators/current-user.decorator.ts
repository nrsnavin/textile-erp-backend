// src/shared/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// ── @CurrentUser() ─────────────────────────────────────────────────────────
// Extracts the userId (JWT sub claim) from the request.
// Requires JwtAuthGuard to have run first.
//
// Usage:
//   async getProfile(@CurrentUser() userId: string) { ... }
//   async updateSettings(@CurrentUser() userId: string) { ... }

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.user?.sub;
  },
);

// ── @CurrentTenant() ──────────────────────────────────────────────────────
// Extracts the tenantId from the JWT payload.
// Requires JwtAuthGuard and TenantGuard to have run first.
//
// Usage:
//   async listOrders(@CurrentTenant() tenantId: string) { ... }
//   async createOrder(@CurrentTenant() tenantId: string) { ... }

export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.user?.tenantId;
  },
);

// ── @CurrentRoles() ───────────────────────────────────────────────────────
// Extracts the roles array from the JWT payload.
//
// Usage:
//   async getMenuItems(@CurrentRoles() roles: string[]) { ... }

export const CurrentRoles = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string[] => {
    const request = ctx.switchToHttp().getRequest();
    return request.user?.roles ?? [];
  },
);

// ── @CurrentUserPayload() ─────────────────────────────────────────────────
// Extracts the full JWT payload — use when you need multiple fields at once.
//
// Usage:
//   async doSomething(@CurrentUserPayload() user: JwtPayload) { ... }

export interface AuthUser {
  sub:      string;
  email:    string;
  tenantId: string;
  roles:    string[];
}

export const CurrentUserPayload = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
