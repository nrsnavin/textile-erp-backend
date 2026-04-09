import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AuditService }  from '../../shared/services/audit.service';
import { paginate }      from '../../shared/utils/pagination.util';
import {
  CreateBomDto,
  StockAdjustmentDto,
  IssueToProductionDto,
  ReturnFromProductionDto,
  TransferStockDto,
  SetOpeningStockDto,
  MovementFilterDto,
} from './dto/inventory.dto';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit:  AuditService,
  ) {}

  // ── BOM ───────────────────────────────────────────────────────────────────

  async listBoms(tenantId: string) {
    return (this.prisma as any).bom.findMany({
      where:   { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        item: { select: { id: true, name: true, code: true } },
      },
    });
  }

  async getBom(id: string, tenantId: string) {
    const bom = await (this.prisma as any).bom.findFirst({
      where: { id, tenantId },
      include: {
        item:  { select: { id: true, name: true, code: true } },
        lines: {
          include: {
            rawItem: { select: { id: true, name: true, code: true, unit: true } },
          },
        },
      },
    });

    if (!bom) throw new NotFoundException(`BOM ${id} not found`);
    return bom;
  }

  async createBom(dto: CreateBomDto, tenantId: string, userId: string) {
    const { lines, itemId, styleCode, remarks } = dto;

    await (this.prisma as any).bom.updateMany({
      where: {
        tenantId,
        itemId,
        ...(styleCode ? { styleCode } : {}),
        isActive: true,
      },
      data: { isActive: false },
    });

    const latestVersion = await (this.prisma as any).bom.findFirst({
      where:   { tenantId, itemId, ...(styleCode ? { styleCode } : {}) },
      orderBy: { version: 'desc' },
      select:  { version: true },
    });

    const version = latestVersion ? latestVersion.version + 1 : 1;

    const bom = await (this.prisma as any).bom.create({
      data: {
        tenantId,
        itemId,
        styleCode:   styleCode ?? null,
        version,
        isActive:    true,
        remarks:     remarks   ?? null,
        createdById: userId,
        lines: {
          create: lines.map(l => ({
            tenantId,
            rawItemId:  l.rawItemId,
            qty:        l.qty,
            unit:       l.unit,
            wastagePct: l.wastagePct ?? 0,
            remarks:    l.remarks    ?? null,
          })),
        },
      },
      include: {
        item:  { select: { id: true, name: true, code: true } },
        lines: true,
      },
    });

    await this.audit.log({
      tenantId, userId,
      action:    'CREATE',
      tableName: 'boms',
      recordId:  bom.id,
      newValues: { itemId, version, styleCode },
    });

    return bom;
  }

  // ── Stock balances ────────────────────────────────────────────────────────

  async listStockBalances(tenantId: string, location?: string) {
    return (this.prisma as any).stockBalance.findMany({
      where: {
        tenantId,
        ...(location ? { location } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        item: { select: { id: true, name: true, code: true, unit: true } },
      },
    });
  }

  // ── Movement history (replaces getStockLedger) ────────────────────────────

  async getMovementHistory(filters: MovementFilterDto, tenantId: string) {
    const page  = filters.page  ?? 1;
    const limit = filters.limit ?? 20;
    const skip  = (page - 1) * limit;

    const where: any = { tenantId };
    if (filters.itemId)    where.itemId    = filters.itemId;
    if (filters.location)  where.location  = filters.location;
    if (filters.entryType) where.entryType = filters.entryType;
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo)   where.createdAt.lte = new Date(filters.dateTo);
    }

    const [rows, total] = await Promise.all([
      (this.prisma as any).stockLedger.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { createdAt: 'desc' },
        include: {
          item: { select: { id: true, name: true, code: true, unit: true } },
        },
      }),
      (this.prisma as any).stockLedger.count({ where }),
    ]);

    return paginate(rows, total, { page, limit, skip } as any);
  }

  // ── Core movement engine ──────────────────────────────────────────────────
  //
  // All stock writes go through this single method.
  // qty is SIGNED: positive = stock IN, negative = stock OUT.
  // The balance table is updated atomically alongside the ledger entry.

  private async postMovement(
    params: {
      itemId:    string;
      location:  string;
      entryType: string;
      qty:       number;   // signed
      rate?:     number;
      refType?:  string;
      refId?:    string;
      remarks?:  string;
    },
    tenantId: string,
    userId:   string,
  ) {
    const { itemId, location, entryType, qty, rate, refType, refId, remarks } = params;

    // Use a transaction so ledger + balance are always consistent
    return this.prisma.$transaction(async (tx: any) => {
      // 1. Read current balance (or default zeros)
      const balance = await tx.stockBalance.findFirst({
        where: { tenantId, itemId, location },
      });

      const currentOnHand = balance ? Number(balance.onHand) : 0;
      const currentReserved = balance ? Number(balance.reserved) : 0;

      // 2. Validate: prevent negative on-hand
      const newOnHand = currentOnHand + qty;
      if (newOnHand < 0) {
        throw new BadRequestException(
          `Insufficient stock for item ${itemId} at ${location}. ` +
          `On hand: ${currentOnHand}, requested: ${Math.abs(qty)}`,
        );
      }

      const newAvailable = newOnHand - currentReserved;

      // 3. Write ledger entry
      const ledger = await tx.stockLedger.create({
        data: {
          tenantId,
          itemId,
          location,
          entryType,
          qty,
          balanceQty:  newOnHand,
          rate:        rate    ?? null,
          refType:     refType ?? null,
          refId:       refId   ?? null,
          remarks:     remarks ?? null,
          createdById: userId,
        },
      });

      // 4. Upsert balance cache
      let updatedBalance: any;
      if (balance) {
        updatedBalance = await tx.stockBalance.update({
          where: { id: balance.id },
          data:  { onHand: newOnHand, available: newAvailable },
        });
      } else {
        updatedBalance = await tx.stockBalance.create({
          data: {
            tenantId,
            itemId,
            location,
            onHand:    newOnHand,
            reserved:  0,
            available: newOnHand,
          },
        });
      }

      return { ledger, balance: updatedBalance };
    });
  }

  // ── Public movement methods ───────────────────────────────────────────────

  async adjustStock(dto: StockAdjustmentDto, tenantId: string, userId: string) {
    const result = await this.postMovement(
      {
        itemId:    dto.itemId,
        location:  dto.location ?? 'MAIN',
        entryType: 'ADJUSTMENT',
        qty:       dto.qty,
        remarks:   dto.reason,
      },
      tenantId,
      userId,
    );

    await this.audit.log({
      tenantId, userId,
      action:    'ADJUSTMENT',
      tableName: 'stock_ledger',
      recordId:  result.ledger.id,
      newValues: { itemId: dto.itemId, location: dto.location ?? 'MAIN', qty: dto.qty, reason: dto.reason },
    });

    return result;
  }

  async issueToProduction(dto: IssueToProductionDto, tenantId: string, userId: string) {
    const result = await this.postMovement(
      {
        itemId:    dto.itemId,
        location:  dto.location ?? 'MAIN',
        entryType: 'ISSUE_TO_PROD',
        qty:       -Math.abs(dto.qty),   // always negative (OUT)
        refType:   dto.orderId ? 'ORDER' : undefined,
        refId:     dto.orderId,
        remarks:   dto.remarks,
      },
      tenantId,
      userId,
    );

    await this.audit.log({
      tenantId, userId,
      action:    'ISSUE_TO_PROD',
      tableName: 'stock_ledger',
      recordId:  result.ledger.id,
      newValues: { itemId: dto.itemId, qty: dto.qty, orderId: dto.orderId },
    });

    return result;
  }

  async returnFromProduction(dto: ReturnFromProductionDto, tenantId: string, userId: string) {
    const result = await this.postMovement(
      {
        itemId:    dto.itemId,
        location:  dto.location ?? 'MAIN',
        entryType: 'RETURN_FROM_PROD',
        qty:       Math.abs(dto.qty),    // always positive (IN)
        refType:   dto.orderId ? 'ORDER' : undefined,
        refId:     dto.orderId,
        remarks:   dto.remarks,
      },
      tenantId,
      userId,
    );

    await this.audit.log({
      tenantId, userId,
      action:    'RETURN_FROM_PROD',
      tableName: 'stock_ledger',
      recordId:  result.ledger.id,
      newValues: { itemId: dto.itemId, qty: dto.qty, orderId: dto.orderId },
    });

    return result;
  }

  async transferStock(dto: TransferStockDto, tenantId: string, userId: string) {
    // Two movements in one outer transaction: OUT from source, IN to destination
    return this.prisma.$transaction(async (tx: any) => {
      // Read source balance
      const srcBalance = await tx.stockBalance.findFirst({
        where: { tenantId, itemId: dto.itemId, location: dto.fromLocation },
      });
      const srcOnHand = srcBalance ? Number(srcBalance.onHand) : 0;
      if (srcOnHand < dto.qty) {
        throw new BadRequestException(
          `Insufficient stock at ${dto.fromLocation}. On hand: ${srcOnHand}, requested: ${dto.qty}`,
        );
      }

      // OUT movement (source)
      const newSrcOnHand = srcOnHand - dto.qty;
      const srcLedger = await tx.stockLedger.create({
        data: {
          tenantId,
          itemId:      dto.itemId,
          location:    dto.fromLocation,
          entryType:   'TRANSFER_OUT',
          qty:         -dto.qty,
          balanceQty:  newSrcOnHand,
          refType:     'TRANSFER',
          refId:       dto.toLocation,
          remarks:     dto.remarks ?? null,
          createdById: userId,
        },
      });

      if (srcBalance) {
        await tx.stockBalance.update({
          where: { id: srcBalance.id },
          data:  { onHand: newSrcOnHand, available: newSrcOnHand - Number(srcBalance.reserved) },
        });
      } else {
        await tx.stockBalance.create({
          data: { tenantId, itemId: dto.itemId, location: dto.fromLocation, onHand: newSrcOnHand, reserved: 0, available: newSrcOnHand },
        });
      }

      // IN movement (destination)
      const dstBalance = await tx.stockBalance.findFirst({
        where: { tenantId, itemId: dto.itemId, location: dto.toLocation },
      });
      const dstOnHand = dstBalance ? Number(dstBalance.onHand) : 0;
      const newDstOnHand = dstOnHand + dto.qty;

      const dstLedger = await tx.stockLedger.create({
        data: {
          tenantId,
          itemId:      dto.itemId,
          location:    dto.toLocation,
          entryType:   'TRANSFER_IN',
          qty:         dto.qty,
          balanceQty:  newDstOnHand,
          refType:     'TRANSFER',
          refId:       dto.fromLocation,
          remarks:     dto.remarks ?? null,
          createdById: userId,
        },
      });

      if (dstBalance) {
        await tx.stockBalance.update({
          where: { id: dstBalance.id },
          data:  { onHand: newDstOnHand, available: newDstOnHand - Number(dstBalance.reserved) },
        });
      } else {
        await tx.stockBalance.create({
          data: { tenantId, itemId: dto.itemId, location: dto.toLocation, onHand: newDstOnHand, reserved: 0, available: newDstOnHand },
        });
      }

      return { srcLedger, dstLedger };
    });
  }

  async setOpeningStock(dto: SetOpeningStockDto, tenantId: string, userId: string) {
    const result = await this.postMovement(
      {
        itemId:    dto.itemId,
        location:  dto.location ?? 'MAIN',
        entryType: 'OPENING_STOCK',
        qty:       Math.abs(dto.qty),
        rate:      dto.rate,
        remarks:   dto.remarks,
      },
      tenantId,
      userId,
    );

    await this.audit.log({
      tenantId, userId,
      action:    'OPENING_STOCK',
      tableName: 'stock_ledger',
      recordId:  result.ledger.id,
      newValues: { itemId: dto.itemId, qty: dto.qty, rate: dto.rate },
    });

    return result;
  }

  // ── Rebuild balance from ledger (admin reconciliation) ────────────────────

  async rebuildBalance(itemId: string, location: string, tenantId: string) {
    const result = await (this.prisma as any).stockLedger.aggregate({
      where: { tenantId, itemId, location },
      _sum:  { qty: true },
    });

    const onHand = Number(result._sum.qty ?? 0);

    // Read reserved before overwriting onHand
    const existing = await (this.prisma as any).stockBalance.findFirst({
      where: { tenantId, itemId, location },
    });
    const reserved  = existing ? Number(existing.reserved) : 0;
    const available = onHand - reserved;

    let balance: any;
    if (existing) {
      balance = await (this.prisma as any).stockBalance.update({
        where: { id: existing.id },
        data:  { onHand, available },
      });
    } else {
      balance = await (this.prisma as any).stockBalance.create({
        data: { tenantId, itemId, location, onHand, reserved: 0, available: onHand },
      });
    }

    return { balance, rebuiltFrom: 'ledger' };
  }

  // ── Post GRN ──────────────────────────────────────────────────────────────

  async postGrn(grnId: string, tenantId: string, userId: string) {
    const grn = await (this.prisma as any).grn.findFirst({
      where:   { id: grnId, tenantId },
      include: { lines: true },
    });

    if (!grn) throw new NotFoundException(`GRN ${grnId} not found`);

    if (grn.status === 'POSTED') {
      throw new BadRequestException(`GRN ${grnId} has already been posted`);
    }

    const location = grn.location ?? 'MAIN';
    const ledgerEntries: any[] = [];

    for (const line of grn.lines as any[]) {
      const qty = Number(line.acceptedQty ?? line.qty);
      const { ledger } = await this.postMovement(
        {
          itemId:    line.itemId,
          location,
          entryType: 'GRN_IN',
          qty,
          rate:      line.rate ?? undefined,
          refType:   'GRN',
          refId:     grnId,
          remarks:   `GRN posting: ${grn.grnNumber ?? grnId}`,
        },
        tenantId,
        userId,
      );
      ledgerEntries.push(ledger);
    }

    const updatedGrn = await (this.prisma as any).grn.update({
      where: { id: grnId },
      data:  { status: 'POSTED' },
    });

    await this.audit.log({
      tenantId, userId,
      action:    'POST_GRN',
      tableName: 'grn',
      recordId:  grnId,
      oldValues: { status: grn.status },
      newValues: { status: 'POSTED', ledgerEntries: ledgerEntries.length },
    });

    return { grn: updatedGrn, ledgerEntries };
  }
}
