// src/shared/decorators/api-auth.decorator.ts
import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiUnauthorizedResponse, ApiForbiddenResponse } from '@nestjs/swagger';
import { JwtAuthGuard }  from '../guards/jwt-auth.guard';
import { TenantGuard }   from '../guards/tenant.guard';
import { RolesGuard }    from '../guards/roles.guard';
import { Roles }         from './roles.decorator';
import { Role }          from '../guards/roles.guard';

// ── @ApiAuth(...roles) ────────────────────────────────────────────────────
// Combines all three guards + Swagger decorators into one decorator.
// Replaces the verbose:
//   @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
//   @ApiBearerAuth()
//   @Roles(Role.OWNER, Role.MERCHANDISER)
//   @ApiUnauthorizedResponse(...)
//   @ApiForbiddenResponse(...)
//
// With the clean:
//   @ApiAuth(Role.OWNER, Role.MERCHANDISER)
//
// Usage on a method:
//   @ApiAuth(Role.OWNER, Role.MERCHANDISER)
//   @Post(':id/confirm')
//   async confirmOrder(...) { ... }
//
// Usage on a controller (applies to all methods):
//   @ApiAuth()
//   @Controller('api/v1/orders')
//   export class OrdersController { ... }

export function ApiAuth(...roles: Role[]) {
  return applyDecorators(
    UseGuards(JwtAuthGuard, TenantGuard, RolesGuard),
    ApiBearerAuth(),
    ...(roles.length > 0 ? [Roles(...roles)] : []),
    ApiUnauthorizedResponse({ description: 'JWT missing, expired, or invalid' }),
    ApiForbiddenResponse({ description: 'Insufficient role permissions' }),
  );
}
