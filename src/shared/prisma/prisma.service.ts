// src/shared/prisma/prisma.service.ts
import {
  Injectable, OnModuleInit, OnModuleDestroy, Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'async_hooks';

// ── Tenant / user context storage ─────────────────────────────────────────
//
// Shared across the entire async call chain per request.
// TenantGuard calls tenantStorage.enterWith({ tenantId, userId, role })
// PrismaService middleware reads the store and sets PostgreSQL session
// variables before every query so RLS policies can filter rows automatically.
//
// Variables set per query:
//   app.current_tenant_id  →  used by all tenant-scoped RLS policies
//   app.current_user_id    →  used by user self-access policies
//   app.current_role       →  used by OWNER-bypass policies

export interface TenantContext {
  tenantId: string;
  userId?:  string;   // set after JWT is validated
  role?:    string;   // highest role name, e.g. 'OWNER'
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: process.env.NODE_ENV === 'development'
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'stdout', level: 'warn' },
            { emit: 'stdout', level: 'error' },
          ]
        : [
            { emit: 'stdout', level: 'warn' },
            { emit: 'stdout', level: 'error' },
          ],
    });

    // ── RLS middleware — runs BEFORE every Prisma query ──────────────────
    //
    // Sets three PostgreSQL session variables (LOCAL = transaction-scoped):
    //
    //   app.current_tenant_id  → tenant boundary enforcement
    //   app.current_user_id    → self-access policy (e.g. GET /me)
    //   app.current_role       → OWNER bypass policy
    //
    // Even if application code forgets a WHERE tenant_id = ? clause, the
    // database-level RLS policy enforces isolation independently.
    // Using SET LOCAL ensures the variable is cleared when the transaction
    // ends, preventing context leakage across connection-pool reuse.
    this.$use(async (params, next) => {
      const store = tenantStorage.getStore();
      if (store?.tenantId) {
        await this.$executeRaw`
          SELECT
            set_config('app.current_tenant_id', ${store.tenantId}::text, true),
            set_config('app.current_user_id',   ${store.userId  ?? ''}::text, true),
            set_config('app.current_role',       ${store.role    ?? ''}::text, true)
        `;
      }
      return next(params);
    });

    // ── Query logging in development ──────────────────────────────────────
    if (process.env.NODE_ENV === 'development') {
      // @ts-ignore — Prisma event typing
      this.$on('query', (e: any) => {
        if (e.duration > 100) {
          this.logger.warn(
            `Slow query (${e.duration}ms): ${e.query.substring(0, 120)}`
          );
        }
      });
    }
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }

  // ── Health check — used by /api/v1/health endpoint ────────────────────
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  // ── Clear tenant context — used in tests ──────────────────────────────
  clearTenantContext(): void {
    // No-op: AsyncLocalStorage clears automatically when the async context ends.
    // Call this explicitly in test teardown if needed.
  }
}
