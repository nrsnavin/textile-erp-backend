// src/shared/interceptors/response.interceptor.ts
import {
  Injectable, NestInterceptor, ExecutionContext,
  CallHandler, Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map, tap }   from 'rxjs/operators';
import { Request }    from 'express';

// ── Standard API response envelope ────────────────────────────────────────
// Every successful response from the API follows this shape.
// Flutter and Next.js clients always know where to look for data.
//
// Success: { data: T,    meta: PaginationMeta | null, errors: null    }
// Error:   { data: null, meta: null,                  errors: ErrorBody }

export interface ApiResponse<T> {
  data:   T | null;
  meta:   PaginationMeta | Record<string, unknown> | null;
  errors: null;
}

export interface PaginationMeta {
  page:    number;
  limit:   number;
  total:   number;
  pages:   number;
}

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  private readonly logger = new Logger('HTTP');

  intercept(
    context: ExecutionContext,
    next:    CallHandler<T>,
  ): Observable<ApiResponse<T>> {
    const req     = context.switchToHttp().getRequest<Request>();
    const startAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startAt;
        const res      = context.switchToHttp().getResponse();
        this.logger.log(
          `${req.method} ${req.url} → ${res.statusCode} [${duration}ms]`
        );
      }),
      map(data => {
        // If the service already returns a paginated { data, meta } shape,
        // preserve it and just add errors: null
        if (
          data &&
          typeof data === 'object' &&
          'data'  in (data as object) &&
          'meta'  in (data as object)
        ) {
          return { ...(data as object), errors: null } as ApiResponse<T>;
        }

        // Otherwise wrap the raw return value
        return { data, meta: null, errors: null };
      }),
    );
  }
}
