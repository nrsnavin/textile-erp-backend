// src/modules/mrp/mrp.repository.ts
import { Injectable }    from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { CreateBomDto, UpdateBomDto, MrpRunFilterDto, PrFilterDto, UpsertStockDto } from './dto/mrp.dto';
import { paginate }      from '../../shared/utils/pagination.util';
import { BomInput, BomLineInput, OrderDemand, StockInput } from './mrp-engine';

@Injectable()
export class MrpRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // BOM
  // ═══════════════════════════════════════════════════════════════════════════

  async createBom(dto: CreateBomDto, tenantId: string, userId: string) {
    return (this.prisma.bom.create as any)({
      data: {
        tenantId,
        parentItemId: dto.parentItemId,
        version:      dto.version ?? 1,
        remarks:      dto.remarks,
        createdById:  userId,
        lines: {
          create: dto.lines.map(l => ({
            tenantId,
            childItemId:  l.childItemId,
            qtyPer:       l.qtyPer,
            unit:         l.unit,
            wastePct:     l.wastePct ?? 0,
            leadTimeDays: l.leadTimeDays ?? 7,
            remarks:      l.remarks,
          })),
        },
      },
      include: { lines: { include: { childItem: true } }, parentItem: true },
    });
  }

  async findBomById(id: string, tenantId: string) {
    return (this.prisma.bom.findFirst as any)({
      where: { id, tenantId },
      include: { lines: { include: { childItem: true } }, parentItem: true },
    });
  }

  async findActiveBomByItem(parentItemId: string, tenantId: string) {
    return (this.prisma.bom.findFirst as any)({
      where: { parentItemId, tenantId, isActive: true },
      include: { lines: { include: { childItem: true } } },
    });
  }

  async listBoms(tenantId: string) {
    return (this.prisma.bom.findMany as any)({
      where: { tenantId, isActive: true },
      include: { parentItem: true, lines: { include: { childItem: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateBom(id: string, tenantId: string, dto: UpdateBomDto) {
    if (dto.lines) {
      // Replace all lines atomically
      await (this.prisma.bomLine.deleteMany as any)({ where: { bomId: id, tenantId } });
      await (this.prisma.bomLine.createMany as any)({
        data: dto.lines.map(l => ({
          tenantId,
          bomId:        id,
          childItemId:  l.childItemId,
          qtyPer:       l.qtyPer,
          unit:         l.unit,
          wastePct:     l.wastePct ?? 0,
          leadTimeDays: l.leadTimeDays ?? 7,
          remarks:      l.remarks,
        })),
      });
    }

    return (this.prisma.bom.update as any)({
      where: { id },
      data: {
        ...(dto.remarks !== undefined && { remarks: dto.remarks }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: { lines: { include: { childItem: true } }, parentItem: true },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MRP DATA FETCHERS — build inputs for the engine
  // ═══════════════════════════════════════════════════════════════════════════

  /** Fetch all active BOMs with lines → Map<parentItemId, BomInput> */
  async loadBomMap(tenantId: string): Promise<Map<string, BomInput>> {
    const boms = await (this.prisma.bom.findMany as any)({
      where: { tenantId, isActive: true },
      include: { lines: { include: { childItem: true } } },
    });

    const map = new Map<string, BomInput>();
    for (const bom of boms) {
      map.set(bom.parentItemId, {
        parentItemId: bom.parentItemId,
        lines: bom.lines.map((l: any) => ({
          childItemId:   l.childItemId,
          childItemCode: l.childItem?.code ?? l.childItemId,
          childItemName: l.childItem?.name ?? 'Unknown',
          qtyPer:        l.qtyPer,
          unit:          l.unit,
          wastePct:      l.wastePct,
          leadTimeDays:  l.leadTimeDays,
        } as BomLineInput)),
      });
    }
    return map;
  }

  /** Fetch order demands from CONFIRMED + IN_PRODUCTION orders. */
  async loadOrderDemands(
    tenantId: string,
    orderIds?: string[],
  ): Promise<OrderDemand[]> {
    const where: any = {
      tenantId,
      status: { in: ['CONFIRMED', 'IN_PRODUCTION'] },
      ...(orderIds && orderIds.length > 0 && { id: { in: orderIds } }),
    };

    const orders = await this.prisma.order.findMany({
      where,
      include: { orderLines: true },
    });

    const demands: OrderDemand[] = [];
    for (const order of orders) {
      for (const line of order.orderLines) {
        demands.push({
          orderId:      order.id,
          itemId:       line.itemId,
          qty:          line.qty,
          deliveryDate: order.deliveryDate,
        });
      }
    }
    return demands;
  }

  /** Fetch all stock balances → Map<itemId, StockInput> */
  async loadStockMap(tenantId: string): Promise<Map<string, StockInput>> {
    const balances = await (this.prisma.stockBalance.findMany as any)({
      where: { tenantId },
    });

    const map = new Map<string, StockInput>();
    for (const b of balances) {
      const existing = map.get(b.itemId);
      if (existing) {
        // Aggregate across locations
        existing.onHand += b.onHand;
        existing.onOrder += b.onOrder;
        existing.allocated += b.allocated;
      } else {
        map.set(b.itemId, {
          itemId:    b.itemId,
          onHand:    b.onHand,
          onOrder:   b.onOrder,
          allocated: b.allocated,
          unit:      b.unit,
        });
      }
    }
    return map;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MRP RUN PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════════════

  async createMrpRun(tenantId: string, userId: string) {
    return (this.prisma.mrpRun.create as any)({
      data: { tenantId, createdById: userId },
    });
  }

  async completeMrpRun(
    id: string,
    data: {
      status: 'COMPLETED' | 'FAILED';
      orderCount?: number;
      lineCount?: number;
      requisitionCount?: number;
      durationMs?: number;
      error?: string;
    },
  ) {
    return (this.prisma.mrpRun.update as any)({
      where: { id },
      data: { ...data, completedAt: new Date() },
    });
  }

  async saveMrpLines(lines: Array<Record<string, any>>) {
    if (lines.length === 0) return;
    return (this.prisma.mrpLine.createMany as any)({ data: lines });
  }

  async savePurchaseRequisitions(prs: Array<Record<string, any>>) {
    if (prs.length === 0) return;
    return (this.prisma.purchaseRequisition.createMany as any)({ data: prs });
  }

  async findMrpRunById(id: string, tenantId: string) {
    return (this.prisma.mrpRun.findFirst as any)({
      where: { id, tenantId },
      include: { lines: true, requisitions: true },
    });
  }

  async listMrpRuns(filters: MrpRunFilterDto, tenantId: string) {
    const where: any = {
      tenantId,
      ...(filters.status && { status: filters.status }),
    };

    const [rows, total] = await this.prisma.$transaction([
      (this.prisma.mrpRun.findMany as any)({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.skip,
        take: filters.limit,
      }),
      (this.prisma.mrpRun as any).count({ where }),
    ]);

    return paginate(rows, total, filters);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PURCHASE REQUISITIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async listPurchaseRequisitions(filters: PrFilterDto, tenantId: string) {
    const where: any = {
      tenantId,
      ...(filters.status   && { status: filters.status }),
      ...(filters.mrpRunId && { mrpRunId: filters.mrpRunId }),
      ...(filters.search && {
        OR: [
          { prNumber: { contains: filters.search, mode: 'insensitive' } },
          { itemCode: { contains: filters.search, mode: 'insensitive' } },
          { itemName: { contains: filters.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [rows, total] = await this.prisma.$transaction([
      (this.prisma.purchaseRequisition.findMany as any)({
        where,
        orderBy: { [filters.sortBy ?? 'orderByDate']: filters.sortDir ?? 'asc' },
        skip: filters.skip,
        take: filters.limit,
      }),
      (this.prisma.purchaseRequisition as any).count({ where }),
    ]);

    return paginate(rows, total, filters);
  }

  async approvePrs(prIds: string[], tenantId: string) {
    return (this.prisma.purchaseRequisition.updateMany as any)({
      where: { id: { in: prIds }, tenantId, status: 'OPEN' },
      data:  { status: 'APPROVED' },
    });
  }

  async findPrById(id: string, tenantId: string) {
    return (this.prisma.purchaseRequisition.findFirst as any)({
      where: { id, tenantId },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STOCK BALANCE
  // ═══════════════════════════════════════════════════════════════════════════

  async upsertStock(dto: UpsertStockDto, tenantId: string) {
    const location = dto.location ?? 'MAIN';
    return (this.prisma.stockBalance.upsert as any)({
      where: {
        tenantId_itemId_location: { tenantId, itemId: dto.itemId, location },
      },
      create: {
        tenantId,
        itemId:    dto.itemId,
        location,
        onHand:    dto.onHand,
        allocated: dto.allocated ?? 0,
        onOrder:   dto.onOrder ?? 0,
        unit:      dto.unit,
      },
      update: {
        onHand:    dto.onHand,
        allocated: dto.allocated ?? 0,
        onOrder:   dto.onOrder ?? 0,
        unit:      dto.unit,
      },
    });
  }

  async listStock(tenantId: string) {
    return (this.prisma.stockBalance.findMany as any)({
      where: { tenantId },
      include: { item: true },
      orderBy: { itemId: 'asc' },
    });
  }

  /** Generate the next PR number: PR-2026-0001 */
  async nextPrNumber(tenantId: string): Promise<number> {
    const count = await (this.prisma.purchaseRequisition as any).count({
      where: { tenantId },
    });
    return count + 1;
  }
}
