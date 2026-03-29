// src/shared/decorators/public.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../guards/jwt-auth.guard';

// ── @Public() ─────────────────────────────────────────────────────────────
// Marks a route as publicly accessible — JwtAuthGuard skips JWT validation.
//
// Usage:
//   @Public()
//   @Post('login')
//   async login(@Body() dto: LoginDto) { ... }
//
// Use on auth endpoints: login, register, forgot-password, reset-password.

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
