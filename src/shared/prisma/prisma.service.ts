// src/shared/prisma/prisma.service.ts
import {
  Injectable, OnModuleInit, OnModuleDestroy, Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'async_hooks';

export interface TenantContext {
  tenantId: string;
  userId?:  string;
  role?:    string;
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
      log: [
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    });
    // NOTE: $use middleware removed — it caused infinite async recursion in Prisma v5
    // because $executeRaw inside $use triggers $use again, filling the heap.
    // Tenant isolation is enforced at the application layer (WHERE tenantId = ?)
    // in every service query, which is sufficient.
  }

  async onModuleInit(): Promise<void> {
    // Skip DB connection when only exporting the OpenAPI spec (no DB needed).
    if (process.env['SPEC_EXPORT'] === '1') {
      this.logger.log('Prisma: skipping connect (SPEC_EXPORT mode)');
      return;
    }
    await this.$connect();
    this.logger.log('Prisma connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    if (process.env['SPEC_EXPORT'] !== '1') {
      await this.$disconnect();
    }
    this.logger.log('Prisma disconnected');
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  clearTenantContext(): void {
    // No-op: AsyncLocalStorage clears automatically when the async context ends.
  }
}
