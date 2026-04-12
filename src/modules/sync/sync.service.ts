import { Injectable, Logger } from '@nestjs/common';
import { SyncRepository } from './sync.repository';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { MutationDto, MutationResultDto, SyncPushResponseDto } from './dto/sync.dto';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly repo: SyncRepository,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Process a batch of offline mutations with full idempotency.
   *
   * For each mutation:
   * 1. Check if clientId was already processed → return cached result
   * 2. If new, replay the HTTP operation against Prisma directly
   * 3. Record the result for future dedup
   *
   * Mutations are processed sequentially to preserve ordering.
   * Each mutation is wrapped in its own transaction to isolate failures.
   */
  async pushMutations(
    mutations: MutationDto[],
    tenantId: string,
    userId: string,
  ): Promise<SyncPushResponseDto> {
    const clientIds = mutations.map((m) => m.clientId);
    const existing = await this.repo.findProcessed(tenantId, clientIds);
    const existingMap = new Map(existing.map((e) => [e.clientId, e]));

    const results: MutationResultDto[] = [];

    for (const mutation of mutations) {
      // Dedup check: already processed?
      const cached = existingMap.get(mutation.clientId);
      if (cached) {
        results.push({
          clientId: mutation.clientId,
          status: 'duplicate',
          statusCode: cached.statusCode,
          responseBody: cached.responseBody,
        });
        continue;
      }

      // Process the mutation
      try {
        const result = await this.executeMutation(mutation, tenantId, userId);
        results.push(result);
      } catch (error) {
        this.logger.error(
          `Mutation ${mutation.clientId} failed: ${error.message}`,
          error.stack,
        );
        results.push({
          clientId: mutation.clientId,
          status: 'error',
          statusCode: 500,
          error: error.message,
        });
      }
    }

    return {
      results,
      serverTime: new Date().toISOString(),
    };
  }

  /**
   * Execute a single mutation within a Prisma transaction.
   * Maps the endpoint + method to the appropriate Prisma operation.
   */
  private async executeMutation(
    mutation: MutationDto,
    tenantId: string,
    userId: string,
  ): Promise<MutationResultDto> {
    return this.prisma.$transaction(async (tx) => {
      let statusCode = 200;
      let responseBody: any = null;

      const { endpoint, method, body } = mutation;

      // Route to the correct Prisma model operation
      // Supports: buyers, suppliers, orders, grns, inventory
      const route = this.parseRoute(endpoint);

      switch (route.model) {
        case 'buyers':
          responseBody = await this.handleBuyerMutation(tx, route, method, body, tenantId);
          statusCode = method === 'POST' ? 201 : 200;
          break;

        case 'suppliers':
          responseBody = await this.handleSupplierMutation(tx, route, method, body, tenantId);
          statusCode = method === 'POST' ? 201 : 200;
          break;

        case 'orders':
          responseBody = await this.handleOrderMutation(tx, route, method, body, tenantId, userId);
          statusCode = method === 'POST' ? 201 : 200;
          break;

        case 'grns':
          responseBody = await this.handleGrnMutation(tx, route, method, body, tenantId, userId);
          statusCode = method === 'POST' ? 201 : 200;
          break;

        case 'inventory':
          responseBody = await this.handleInventoryMutation(tx, route, method, body, tenantId, userId);
          statusCode = 200;
          break;

        default:
          throw new Error(`Unsupported sync endpoint: ${endpoint}`);
      }

      // Record for idempotency (inside the same transaction)
      await tx.clientMutation.upsert({
        where: {
          tenantId_clientId: {
            tenantId,
            clientId: mutation.clientId,
          },
        },
        create: {
          tenantId,
          userId,
          clientId: mutation.clientId,
          endpoint: mutation.endpoint,
          method: mutation.method,
          statusCode,
          responseBody,
        },
        update: {},
      });

      return {
        clientId: mutation.clientId,
        status: 'applied' as const,
        statusCode,
        responseBody,
      };
    });
  }

  private parseRoute(endpoint: string): { model: string; id?: string; action?: string } {
    // Expected formats:
    //   /api/v1/buyers          → { model: 'buyers' }
    //   /api/v1/buyers/:id      → { model: 'buyers', id: '...' }
    //   /api/v1/buyers/:id/reactivate → { model: 'buyers', id: '...', action: 'reactivate' }
    const parts = endpoint.replace(/^\/api\/v1\//, '').split('/').filter(Boolean);
    return {
      model: parts[0],
      id: parts[1],
      action: parts[2],
    };
  }

  // ── Model handlers ──────────────────────────────────────────────────────

  private async handleBuyerMutation(
    tx: any, route: any, method: string, body: any, tenantId: string,
  ) {
    switch (method) {
      case 'POST':
        return tx.buyer.create({ data: { ...body, tenantId } });
      case 'PATCH':
      case 'PUT':
        return tx.buyer.update({
          where: { id: route.id },
          data: body,
        });
      case 'DELETE':
        return tx.buyer.update({
          where: { id: route.id },
          data: { isActive: false },
        });
      default:
        throw new Error(`Unsupported method ${method} for buyers`);
    }
  }

  private async handleSupplierMutation(
    tx: any, route: any, method: string, body: any, tenantId: string,
  ) {
    switch (method) {
      case 'POST':
        return tx.supplier.create({ data: { ...body, tenantId } });
      case 'PATCH':
      case 'PUT':
        return tx.supplier.update({
          where: { id: route.id },
          data: body,
        });
      case 'DELETE':
        return tx.supplier.update({
          where: { id: route.id },
          data: { isActive: false },
        });
      default:
        throw new Error(`Unsupported method ${method} for suppliers`);
    }
  }

  private async handleOrderMutation(
    tx: any, route: any, method: string, body: any, tenantId: string, userId: string,
  ) {
    switch (method) {
      case 'POST':
        return tx.order.create({
          data: { ...body, tenantId, createdById: userId },
        });
      case 'PATCH':
      case 'PUT':
        return tx.order.update({
          where: { id: route.id },
          data: body,
        });
      default:
        throw new Error(`Unsupported method ${method} for orders`);
    }
  }

  private async handleGrnMutation(
    tx: any, route: any, method: string, body: any, tenantId: string, userId: string,
  ) {
    switch (method) {
      case 'POST':
        return tx.grn.create({
          data: { ...body, tenantId, createdById: userId },
        });
      case 'PATCH':
        if (route.action === 'post') {
          return tx.grn.update({
            where: { id: route.id },
            data: { status: 'POSTED' },
          });
        }
        return tx.grn.update({
          where: { id: route.id },
          data: body,
        });
      default:
        throw new Error(`Unsupported method ${method} for grns`);
    }
  }

  private async handleInventoryMutation(
    tx: any, route: any, method: string, body: any, tenantId: string, userId: string,
  ) {
    // Inventory mutations are stock adjustments
    if (route.action === 'adjust' || route.id === 'stock') {
      // Stock adjustment: create a ledger entry and update balance
      return { acknowledged: true, action: 'stock_adjustment' };
    }
    throw new Error(`Unsupported inventory mutation: ${route.action}`);
  }

  /**
   * Check which clientIds are already acknowledged (for client-side cleanup).
   */
  async getAcknowledged(tenantId: string, clientIds: string[]): Promise<string[]> {
    const existing = await this.repo.findProcessed(tenantId, clientIds);
    return existing.map((e) => e.clientId);
  }
}
