import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AuditService }  from '../../shared/services/audit.service';
import { KafkaService }  from '../../shared/services/kafka.service';
import { paginate, dateRangeFilter } from '../../shared/utils/pagination.util';
import {
  CreateBomDto,
  StockAdjustmentDto,
  IssueToProductionDto,
  ReturnFromProductionDto,
  TransferStockDto,
  SetOpeningStockDto,
  MovementFilterDto,
} from './dto/inventory.dto';

// Valid ledger entry types — used to validate filter input at the service layer
const VALID_ENTRY_TYPES = new Set([
  'GRN_IN', 'ISSUE_TO_PROD', 'RETURN_FROM_PROD',
  'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'OPENING_STOCK',
]);

// ── Kafka topic constants ─────────────────────────────────────────────────────
const TOPIC_GRN_POSTED     = 'inventory.grn-posted';
const TOPIC_STOCK_MOVEMENT = 'inventory.stock-movement';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit:  AuditService,
    private readonly kafka:  KafkaService,
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
        ...(location?.trim() ? { location: location.trim() } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        item: { select: { id: true, name: true, code: true, unit: true } },
      },
    });
  }

  // ── Movement history ──────────────────────────────────────────────────────

  async getMovementHistory(filters: MovementFilterDto, tenantId: string) {
    // Validate entryType against allowed values
    if (filters.entryType && !VALID_ENTRY_TYPES.has(filters.entryType)) {
      throw new BadRequestException(
        `Invalid entryType "${filters.entryType}". ` +
        `Allowed: ${[...VALID_ENTRY_TYPES].join(', ')}`,
      );
    }

    // Validate dates — catch "new Date('garbage') = Invalid Date"
    if (filters.dateFrom && isNaN(new Date(filters.dateFrom).getTime())) {
      throw new BadRequestException(`Invalid dateFrom: "${filters.dateFrom}"`);
    }
    if (filters.dateTo && isNaN(new Date(filters.dateTo).getTime())) {
      throw new BadRequestException(`Invalid dateTo: "${filters.dateTo}"`);
    }

    const where: any = {
      tenantId,
      ...(filters.itemId    ? { itemId:    filters.itemId }    : {}),
      ...(filters.location?.trim()  ? { location:  filters.location.trim() }  : {}),
      ...(filters.entryType ? { entryType: filters.entryType } : {}),
      ...dateRangeFilter('createdAt', filters.dateFrom, filters.dateTo),
    };

    const [rows, total] = await Promise.all([
      (this.prisma as any).stockLedger.findMany({
        where,
        skip:    filters.skip,
        take:    filters.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          item: { select: { id: true, name: true, code: true, unit: true } },
        },
      }),
      (this.prisma as any).stockLedger.count({ where }),
    ]);

    return paginate(rows, total, filters);
  }

  // ── Core movement engine ──────────────────────────────────────────────────
  //
  // ALL stock writes go through this single private method.
  //   qty is SIGNED: positive = IN, negative = OUT
  //   tx (optional) — pass an existing Prisma transaction client to join the
  //   caller's outer transaction (used by postGrn, transferStock). When omitted
  //   the method opens its own $transaction.
  //
  // Guarantees (within one transaction):
  //   1. Balance is read
  //   2. Negativity check performed
  //   3. Ledger entry created
  //   4. Balance cache upserted
  //   If any step fails the whole transaction rolls back.

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
    tx?: any,  // optional existing transaction client
  ) {
    const { itemId, location, entryType, qty, rate, refType, refId, remarks } = params;

    // Guard: zero-qty movements create noise with no effect
    if (qty === 0) {
      throw new BadRequestException('Quantity must not be zero');
    }

    const run = async (client: any) => {
      // 1. Read current balance
      const balance = await client.stockBalance.findFirst({
        where: { tenantId, itemId, location },
      });

      const currentOnHand   = balance ? Number(balance.onHand)   : 0;
      const currentReserved = balance ? Number(balance.reserved) : 0;

      // 2. Prevent negative on-hand for OUT movements
      const newOnHand = currentOnHand + qty;
      if (newOnHand < 0) {
        throw new BadRequestException(
          `Insufficient stock for item at ${location}: ` +
          `on hand ${currentOnHand}, requested ${Math.abs(qty)}`,
        );
      }

      // available is clamped at 0 — reserved can never exceed onHand in valid state
      const newAvailable = Math.max(0, newOnHand - currentReserved);

      // 3. Write ledger entry (append-only)
      const ledger = await client.stockLedger.create({
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

      // 4. Upsert balance cache — uses Postgres ON CONFLICT (atomic)
      const updatedBalance = await client.stockBalance.upsert({
        where:  { tenantId_itemId_location: { tenantId, itemId, location } },
        update: { onHand: newOnHand, available: newAvailable },
        create: {
          tenantId, itemId, location,
          onHand:    newOnHand,
          reserved:  0,
          available: newOnHand,
        },
      });

      return { ledger, balance: updatedBalance };
    };

    // Use the caller's transaction if provided, otherwise open a new one
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  // ── Public movement methods ───────────────────────────────────────────────

  async adjustStock(dto: StockAdjustmentDto, tenantId: string, userId: string) {
    const location = dto.location?.trim() || 'MAIN';

    const result = await this.postMovement(
      {
        itemId:    dto.itemId,
        location,
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
      newValues: { itemId: dto.itemId, location, qty: dto.qty, reason: dto.reason },
    });

    return result;
  }

  async issueToProduction(dto: IssueToProductionDto, tenantId: string, userId: string) {
    const location = dto.location?.trim() || 'MAIN';

    const result = await this.postMovement(
      {
        itemId:    dto.itemId,
        location,
        entryType: 'ISSUE_TO_PROD',
        qty:       -Math.abs(dto.qty),   // always OUT (negative)
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
      newValues: { itemId: dto.itemId, location, qty: dto.qty, orderId: dto.orderId },
    });

    return result;
  }

  async returnFromProduction(dto: ReturnFromProductionDto, tenantId: string, userId: string) {
    const location = dto.location?.trim() || 'MAIN';

    const result = await this.postMovement(
      {
        itemId:    dto.itemId,
        location,
        entryType: 'RETURN_FROM_PROD',
        qty:       Math.abs(dto.qty),    // always IN (positive)
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
      newValues: { itemId: dto.itemId, location, qty: dto.qty, orderId: dto.orderId },
    });

    return result;
  }

  async transferStock(dto: TransferStockDto, tenantId: string, userId: string) {
    const fromLocation = dto.fromLocation.trim();
    const toLocation   = dto.toLocation.trim();

    if (!fromLocation || !toLocation) {
      throw new BadRequestException('fromLocation and toLocation must not be empty');
    }
    if (fromLocation === toLocation) {
      throw new BadRequestException(
        `fromLocation and toLocation must be different (both are "${fromLocation}")`,
      );
    }

    // Both legs run inside ONE transaction — either both commit or both roll back
    return this.prisma.$transaction(async (tx: any) => {
      // OUT from source — postMovement will validate stock availability
      const { ledger: srcLedger } = await this.postMovement(
        {
          itemId:    dto.itemId,
          location:  fromLocation,
          entryType: 'TRANSFER_OUT',
          qty:       -dto.qty,
          refType:   'TRANSFER',
          refId:     toLocation,
          remarks:   dto.remarks,
        },
        tenantId,
        userId,
        tx,   // share the outer transaction
      );

      // IN to destination
      const { ledger: dstLedger } = await this.postMovement(
        {
          itemId:    dto.itemId,
          location:  toLocation,
          entryType: 'TRANSFER_IN',
          qty:       dto.qty,
          refType:   'TRANSFER',
          refId:     fromLocation,
          remarks:   dto.remarks,
        },
        tenantId,
        userId,
        tx,   // share the outer transaction
      );

      return { srcLedger, dstLedger };
    });
  }

  async setOpeningStock(dto: SetOpeningStockDto, tenantId: string, userId: string) {
    const location = dto.location?.trim() || 'MAIN';

    const result = await this.postMovement(
      {
        itemId:    dto.itemId,
        location,
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
      newValues: { itemId: dto.itemId, location, qty: dto.qty, rate: dto.rate },
    });

    return result;
  }

  // ── Rebuild balance from ledger (admin reconciliation) ────────────────────
  //
  // Reads SUM(qty) from the ledger and overwrites the balance cache.
  // Wrapped in a transaction so no movement can slip in between the
  // aggregate read and the balance write.

  async rebuildBalance(itemId: string, location: string, tenantId: string) {
    const loc = location?.trim() || 'MAIN';

    return this.prisma.$transaction(async (tx: any) => {
      const result = await tx.stockLedger.aggregate({
        where: { tenantId, itemId, location: loc },
        _sum:  { qty: true },
      });

      const onHand = Number(result._sum.qty ?? 0);

      // Preserve existing reserved qty — only recalculate onHand + available
      const existing = await tx.stockBalance.findFirst({
        where: { tenantId, itemId, location: loc },
      });
      const reserved  = existing ? Number(existing.reserved) : 0;
      const available = Math.max(0, onHand - reserved);

      const balance = await tx.stockBalance.upsert({
        where:  { tenantId_itemId_location: { tenantId, itemId, location: loc } },
        update: { onHand, available },
        create: { tenantId, itemId, location: loc, onHand, reserved: 0, available: onHand },
      });

      return { balance, rebuiltFrom: 'ledger', computedOnHand: onHand };
    });
  }

  // ── Post GRN — creates GRN_IN entries + marks GRN as POSTED ──────────────
  //
  // FIX: entire operation runs in ONE transaction.
  // Previously each line ran in its own transaction, so a mid-loop failure
  // would leave partially-committed ledger entries and an un-posted GRN.

  async postGrn(grnId: string, tenantId: string, userId: string) {
    // Fetch GRN and lines BEFORE starting the transaction (read-only, no lock needed)
    const grn = await (this.prisma as any).grn.findFirst({
      where:   { id: grnId, tenantId },
      include: { lines: true },
    });

    if (!grn) throw new NotFoundException(`GRN ${grnId} not found`);

    if (grn.status === 'POSTED') {
      throw new BadRequestException(`GRN ${grnId} has already been posted`);
    }

    if (!grn.lines || grn.lines.length === 0) {
      throw new BadRequestException(`GRN ${grnId} has no lines — cannot post an empty GRN`);
    }

    const location = grn.location?.trim() || 'MAIN';

    // Filter out zero-qty lines before entering the transaction
    const postableLines = (grn.lines as any[]).filter(line => {
      const qty = Number(line.acceptedQty ?? line.qty);
      return qty > 0;
    });

    if (postableLines.length === 0) {
      throw new BadRequestException(
        `GRN ${grnId} has no lines with accepted quantity > 0`,
      );
    }

    // All writes happen inside ONE transaction — ledger entries + GRN status update
    const { ledgerEntries, updatedGrn } = await this.prisma.$transaction(async (tx: any) => {
      const entries: any[] = [];

      for (const line of postableLines) {
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
            remarks:   `GRN ${grn.grnNumber ?? grnId}`,
          },
          tenantId,
          userId,
          tx,   // share the outer transaction — all or nothing
        );

        entries.push(ledger);
      }

      const posted = await tx.grn.update({
        where: { id: grnId },
        data:  { status: 'POSTED' },
      });

      return { ledgerEntries: entries, updatedGrn: posted };
    });

    // Audit log is outside the transaction — audit failure must never roll back stock
    await this.audit.log({
      tenantId, userId,
      action:    'POST_GRN',
      tableName: 'grn',
      recordId:  grnId,
      oldValues: { status: grn.status },
      newValues: { status: 'POSTED', ledgerLines: ledgerEntries.length },
    });

    // ── Kafka: inventory.grn-posted ──────────────────────────────────────────
    // Fire-and-forget — Kafka unavailability must not affect the HTTP response.
    await this.kafka.emit(TOPIC_GRN_POSTED, {
      key: tenantId,
      value: {
        occurredAt:  new Date().toISOString(),
        tenantId,
        triggeredBy: userId,
        grnId,
        grnNumber:   grn.grnNumber ?? grnId,
        supplierId:  grn.supplierId,
        location,
        totalLines:  ledgerEntries.length,
        lines: ledgerEntries.map((e: any, idx: number) => ({
          itemId:   postableLines[idx]?.itemId ?? e.itemId,
          qty:      Number(e.qty),
          rate:     postableLines[idx]?.rate   ?? undefined,
          ledgerId: e.id,
        })),
      },
    });

    return { grn: updatedGrn, ledgerEntries };
  }
}
