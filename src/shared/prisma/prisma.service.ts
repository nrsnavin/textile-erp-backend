// src/shared/prisma/prisma.service.ts
import {
  Injectable, OnModuleInit, OnModuleDestroy, Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'async_hooks';

// ── Tenant context storage ─────────────────────────────────────────────────
// Shared across the entire async call chain per request.
// TenantGuard calls tenantStorage.enterWith({ tenantId })
// PrismaService middleware reads it and sets app.tenant_id in PostgreSQL.
// This triggers Row Level Security policies on every query automatically.

export const tenantStorage = new AsyncLocalStorage<{ tenantId: string }>();

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
    // Sets the PostgreSQL session variable app.tenant_id
    // PostgreSQL RLS policies use this to filter rows automatically.
    // Even if application code forgets a WHERE tenant_id clause,
    // the database enforces isolation independently.
    this.$use(async (params, next) => {
      const store = tenantStorage.getStore();
      if (store?.tenantId) {
        await this.$executeRaw`
          SELECT set_config('app.tenant_id', ${store.tenantId}::text, true)
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
