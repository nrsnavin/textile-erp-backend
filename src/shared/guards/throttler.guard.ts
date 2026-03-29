// src/shared/guards/throttler.guard.ts
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';

// ── Custom ThrottlerGuard ──────────────────────────────────────────────────
// Extends the default guard to return a clean error message
// and identify the client by userId (if authenticated) or IP.

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  // Use userId from JWT as the throttle key when available,
  // fall back to IP address for unauthenticated routes (login, register)
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.sub ?? req.ip ?? 'anonymous';
  }

  protected throwThrottlingException(): never {
    throw new ThrottlerException(
      'Too many requests. Please wait before trying again.'
    );
  }
}
