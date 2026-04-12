import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

@Injectable()
export class SyncRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check which clientIds have already been processed for this tenant.
   * Returns the full ClientMutation rows so we can replay cached responses.
   */
  async findProcessed(tenantId: string, clientIds: string[]) {
    return this.prisma.clientMutation.findMany({
      where: {
        tenantId,
        clientId: { in: clientIds },
      },
    });
  }

  /**
   * Record a processed mutation for idempotency.
   * Uses upsert to handle the rare race where two requests with the
   * same clientId arrive simultaneously — the second one gets the
   * existing record instead of a unique-constraint error.
   */
  async recordMutation(params: {
    tenantId: string;
    userId: string;
    clientId: string;
    endpoint: string;
    method: string;
    statusCode: number;
    responseBody?: any;
  }) {
    return this.prisma.clientMutation.upsert({
      where: {
        tenantId_clientId: {
          tenantId: params.tenantId,
          clientId: params.clientId,
        },
      },
      create: {
        tenantId: params.tenantId,
        userId: params.userId,
        clientId: params.clientId,
        endpoint: params.endpoint,
        method: params.method,
        statusCode: params.statusCode,
        responseBody: params.responseBody ?? undefined,
      },
      update: {}, // no-op if already exists
    });
  }

  /**
   * Prune old mutation records (> 30 days) to prevent table bloat.
   */
  async pruneOldMutations(tenantId: string) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    return this.prisma.clientMutation.deleteMany({
      where: {
        tenantId,
        processedAt: { lt: cutoff },
      },
    });
  }
}
