import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AuditService }  from '../../shared/services/audit.service';
import { paginate }      from '../../shared/utils/pagination.util';
import { CreateBomDto, StockAdjustmentDto } from './dto/inventory.dto';

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

    // Deactivate any previous active BOM for the same item + styleCode
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

  // ── Stock ledger (paginated) ──────────────────────────────────────────────

  async getStockLedger(
    tenantId: string,
    itemId:   string | undefined,
    page:     number,
    limit:    number,
  ) {
    const skip  = (page - 1) * limit;
    const where: any = { tenantId };
    if (itemId) where.itemId = itemId;

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

    // Build a minimal PaginationDto-compatible object for the paginate helper
    return paginate(rows, total, { page, limit, skip } as any);
  }

  // ── Stock adjustment ──────────────────────────────────────────────────────

  async adjustStock(dto: StockAdjustmentDto, tenantId: string, userId: string) {
    const { itemId, qty, reason } = dto;
    const location = dto.location ?? 'MAIN';

    // Fetch or initialise the balance record
    let balance = await (this.prisma as any).stockBalance.findFirst({
      where: { tenantId, itemId, location },
    });

    const currentOnHand = balance ? Number(balance.onHand) : 0;
    const newOnHand     = currentOnHand + Number(qty);

    if (newOnHand < 0) {
      throw new BadRequestException(
        `Adjustment would result in negative stock (current: ${currentOnHand}, adjustment: ${qty})`,
      );
    }

    const reserved  = balance ? Number(balance.reserved) : 0;
    const available = newOnHand - reserved;

    // Upsert balance
    if (balance) {
      balance = await (this.prisma as any).stockBalance.update({
        where: { id: balance.id },
        data:  { onHand: newOnHand, available },
      });
    } else {
      balance = await (this.prisma as any).stockBalance.create({
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

    // Write ledger entry
    const ledger = await (this.prisma as any).stockLedger.create({
      data: {
        tenantId,
        itemId,
        location,
        entryType:   'ADJUSTMENT',
        qty:         qty,
        balanceQty:  newOnHand,
        remarks:     reason,
        createdById: userId,
      },
    });

    await this.audit.log({
      tenantId, userId,
      action:    'ADJUSTMENT',
      tableName: 'stock_ledger',
      recordId:  ledger.id,
      newValues: { itemId, location, qty, balanceQty: newOnHand, reason },
    });

    return { balance, ledger };
  }

  // ── Post GRN — GRN_IN ledger entries + update balances ───────────────────

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
      const itemId    = line.itemId;
      const qty       = Number(line.acceptedQty ?? line.qty);

      // Fetch or initialise balance
      let balance = await (this.prisma as any).stockBalance.findFirst({
        where: { tenantId, itemId, location },
      });

      const currentOnHand = balance ? Number(balance.onHand) : 0;
      const newOnHand     = currentOnHand + qty;
      const reserved      = balance ? Number(balance.reserved) : 0;
      const available     = newOnHand - reserved;

      if (balance) {
        await (this.prisma as any).stockBalance.update({
          where: { id: balance.id },
          data:  { onHand: newOnHand, available },
        });
      } else {
        await (this.prisma as any).stockBalance.create({
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

      const ledger = await (this.prisma as any).stockLedger.create({
        data: {
          tenantId,
          itemId,
          location,
          entryType:   'GRN_IN',
          qty,
          balanceQty:  newOnHand,
          rate:        line.rate ?? null,
          refType:     'GRN',
          refId:       grnId,
          remarks:     `GRN posting: ${grn.grnNumber ?? grnId}`,
          createdById: userId,
        },
      });

      ledgerEntries.push(ledger);
    }

    // Mark GRN as POSTED
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
