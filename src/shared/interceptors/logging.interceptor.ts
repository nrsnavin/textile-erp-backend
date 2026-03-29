// src/shared/interceptors/logging.interceptor.ts
import {
  Injectable, NestInterceptor, ExecutionContext,
  CallHandler, Logger,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError }        from 'rxjs/operators';
import { Request, Response }      from 'express';
import { randomUUID }             from 'crypto';

// ── LoggingInterceptor ─────────────────────────────────────────────────────
// Logs every HTTP request with:
//   - Unique trace ID per request
//   - Method, URL, status code, duration
//   - User ID and tenant ID from JWT (if authenticated)
// The trace ID is also added to the response header X-Request-Id
// so Datadog APM can correlate logs with traces.

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req     = context.switchToHttp().getRequest<Request>();
    const res     = context.switchToHttp().getResponse<Response>();
    const traceId = randomUUID();
    const startAt = Date.now();

    // Attach trace ID to response header
    res.setHeader('X-Request-Id', traceId);

    const userId   = (req as any).user?.sub       ?? 'anonymous';
    const tenantId = (req as any).user?.tenantId  ?? 'none';

    return next.handle().pipe(
      tap(() => {
        this.logger.log(
          `[${traceId}] ${req.method} ${req.url} → ${res.statusCode} ` +
          `[${Date.now() - startAt}ms] user=${userId} tenant=${tenantId}`
        );
      }),
      catchError(err => {
        this.logger.warn(
          `[${traceId}] ${req.method} ${req.url} → ${err.status ?? 500} ` +
          `[${Date.now() - startAt}ms] user=${userId} tenant=${tenantId} ` +
          `error=${err.message}`
        );
        return throwError(() => err);
      }),
    );
  }
}
