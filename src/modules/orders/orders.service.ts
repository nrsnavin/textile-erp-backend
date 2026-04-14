import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AuditService }  from '../../shared/services/audit.service';
import { KafkaService }  from '../../shared/services/kafka.service';
import { paginate }      from '../../shared/utils/pagination.util';
import {
  CreateOrderDto, UpdateOrderDto, OrderFilterDto,
} from './dto/order.dto';

// ── Kafka topic constants ─────────────────────────────────────────────────────

const TOPIC_ORDER_CONFIRMED      = 'order.confirmed';
const TOPIC_ORDER_STATUS_CHANGED = 'order.status-changed';
const TOPIC_ORDER_CANCELLED      = 'order.cancelled';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit:  AuditService,
    private readonly kafka:  KafkaService,
  ) {}

  // ── List orders (paginated) ───────────────────────────────────────────────

  async listOrders(filters: OrderFilterDto, tenantId: string) {
    const { page, limit, status, buyerId, search, dateFrom, dateTo } = filters;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (status)  where.status  = status;
    if (buyerId) where.buyerId = buyerId;

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo)   where.createdAt.lte = new Date(dateTo);
    }

    if (search?.trim()) {
      where.OR = [
        { poNumber: { contains: search.trim(), mode: 'insensitive' } },
        { season:   { contains: search.trim(), mode: 'insensitive' } },
        { remarks:  { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      (this.prisma as any).order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          buyer: { select: { id: true, name: true, country: true } },
        },
      }),
      (this.prisma as any).order.count({ where }),
    ]);

    return paginate(rows, total, filters);
  }

  // ── Get single order with full details ────────────────────────────────────

  async getOrder(id: string, tenantId: string) {
    const order = await (this.prisma as any).order.findFirst({
      where: { id, tenantId },
      include: {
        buyer:     { select: { id: true, name: true, country: true } },
        lines:     true,
        revisions: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  // ── Create order + lines ──────────────────────────────────────────────────

  async createOrder(dto: CreateOrderDto, tenantId: string, userId: string) {
    const { lines, reason: _reason, ...orderFields } = dto as any;

    const totalQty    = lines.reduce((sum: number, l: any) => sum + Number(l.qty), 0);
    const totalStyles = new Set(lines.map((l: any) => l.styleCode)).size;
    const linesJson   = lines;

    const order = await (this.prisma as any).order.create({
      data: {
        tenantId,
        ...orderFields,
        totalQty,
        totalStyles,
        linesJson,
        status:    'DRAFT',
        revision:  1,
        createdById: userId,
        lines: {
          create: lines.map((l: any) => ({
            tenantId,
            styleCode:  l.styleCode,
            itemId:     l.itemId,
            colour:     l.colour   ?? null,
            qty:        l.qty,
            sizesJson:  l.sizesJson,
            unitPrice:  l.unitPrice ?? null,
            currency:   l.currency  ?? 'USD',
          })),
        },
      },
      include: {
        buyer:  { select: { id: true, name: true } },
        lines:  true,
      },
    });

    await this.audit.log({
      tenantId, userId,
      action:    'CREATE',
      tableName: 'orders',
      recordId:  order.id,
      newValues: { poNumber: order.poNumber, buyerId: dto.buyerId, totalQty, totalStyles },
    });

    return order;
  }

  // ── Update order — diffs old vs new, saves revision ──────────────────────

  async updateOrder(id: string, dto: UpdateOrderDto, tenantId: string, userId: string) {
    const existing = await this.getOrder(id, tenantId);

    if (['CANCELLED', 'DISPATCHED'].includes(existing.status)) {
      throw new BadRequestException(
        `Cannot update an order with status ${existing.status}`,
      );
    }

    const { lines, reason, ...orderFields } = dto as any;

    // Build revision snapshot from current state before overwriting
    const linesSnapshot = existing.lines;

    // Compute new aggregates if lines are being replaced
    let totalQty    = existing.totalQty;
    let totalStyles = existing.totalStyles;
    let linesJson   = existing.linesJson;

    let newLines: any[] | undefined;
    if (lines && lines.length > 0) {
      totalQty    = lines.reduce((sum: number, l: any) => sum + Number(l.qty), 0);
      totalStyles = new Set(lines.map((l: any) => l.styleCode)).size;
      linesJson   = lines;

      // Delete old lines and recreate
      newLines = lines.map((l: any) => ({
        tenantId,
        styleCode: l.styleCode,
        itemId:    l.itemId,
        colour:    l.colour   ?? null,
        qty:       l.qty,
        sizesJson: l.sizesJson,
        unitPrice: l.unitPrice ?? null,
        currency:  l.currency  ?? 'USD',
      }));
    }

    const updated = await (this.prisma as any).order.update({
      where: { id },
      data: {
        ...orderFields,
        totalQty,
        totalStyles,
        linesJson,
        revision: { increment: 1 },
        ...(newLines
          ? {
              lines: {
                deleteMany: { orderId: id },
                create: newLines,
              },
            }
          : {}),
        revisions: {
          create: {
            tenantId,
            revision:      existing.revision,
            linesSnapshot,
            reason:        reason ?? null,
            createdById:   userId,
          },
        },
      },
      include: {
        buyer:     { select: { id: true, name: true } },
        lines:     true,
        revisions: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });

    await this.audit.log({
      tenantId, userId,
      action:    'UPDATE',
      tableName: 'orders',
      recordId:  id,
      oldValues: { status: existing.status, revision: existing.revision },
      newValues: { revision: updated.revision, reason: reason ?? null },
    });

    return updated;
  }

  // ── Confirm order (DRAFT → CONFIRMED) ─────────────────────────────────────

  async confirmOrder(id: string, tenantId: string, userId: string) {
    const existing = await this.getOrder(id, tenantId);

    if (existing.status !== 'DRAFT') {
      throw new BadRequestException(
        `Order must be DRAFT to confirm (current: ${existing.status})`,
      );
    }

    const updated = await (this.prisma as any).order.update({
      where: { id },
      data: {
        status:    'CONFIRMED',
        linesJson: existing.lines,   // freeze snapshot at confirmation
      },
      include: {
        buyer:  { select: { id: true, name: true, country: true } },
        lines:  true,
      },
    });

    await this.audit.log({
      tenantId, userId,
      action:    'UPDATE',
      tableName: 'orders',
      recordId:  id,
      oldValues: { status: 'DRAFT' },
      newValues: { status: 'CONFIRMED' },
    });

    // ── Kafka: order.confirmed ───────────────────────────────────────────────
    await this.kafka.emit(TOPIC_ORDER_CONFIRMED, {
      key: tenantId,
      value: {
        occurredAt:   new Date().toISOString(),
        tenantId,
        triggeredBy:  userId,
        orderId:      updated.id,
        poNumber:     updated.poNumber,
        buyerId:      updated.buyerId,
        buyerName:    updated.buyer?.name ?? '',
        deliveryDate: updated.deliveryDate,
        totalQty:     updated.totalQty,
        totalStyles:  updated.totalStyles,
        lines: (updated.lines as any[]).map((l: any) => ({
          styleCode: l.styleCode,
          itemId:    l.itemId,
          qty:       Number(l.qty),
          colour:    l.colour ?? undefined,
        })),
      },
    });

    // ── Kafka: order.status-changed ──────────────────────────────────────────
    await this.kafka.emit(TOPIC_ORDER_STATUS_CHANGED, {
      key: tenantId,
      value: {
        occurredAt:  new Date().toISOString(),
        tenantId,
        triggeredBy: userId,
        orderId:     updated.id,
        poNumber:    updated.poNumber,
        fromStatus:  'DRAFT',
        toStatus:    'CONFIRMED',
      },
    });

    return updated;
  }

  // ── Cancel order (any → CANCELLED) ───────────────────────────────────────

  async cancelOrder(id: string, tenantId: string, userId: string) {
    const existing = await this.getOrder(id, tenantId);

    if (existing.status === 'CANCELLED') {
      throw new BadRequestException('Order is already cancelled');
    }

    if (existing.status === 'DISPATCHED') {
      throw new BadRequestException('Cannot cancel a dispatched order');
    }

    const prevStatus = existing.status;

    const updated = await (this.prisma as any).order.update({
      where: { id },
      data:  { status: 'CANCELLED' },
    });

    await this.audit.log({
      tenantId, userId,
      action:    'UPDATE',
      tableName: 'orders',
      recordId:  id,
      oldValues: { status: existing.status },
      newValues: { status: 'CANCELLED' },
    });

    // ── Kafka: order.cancelled ───────────────────────────────────────────────
    await this.kafka.emit(TOPIC_ORDER_CANCELLED, {
      key: tenantId,
      value: {
        occurredAt:  new Date().toISOString(),
        tenantId,
        triggeredBy: userId,
        orderId:     updated.id,
        poNumber:    existing.poNumber,
        prevStatus,
      },
    });

    // ── Kafka: order.status-changed ──────────────────────────────────────────
    await this.kafka.emit(TOPIC_ORDER_STATUS_CHANGED, {
      key: tenantId,
      value: {
        occurredAt:  new Date().toISOString(),
        tenantId,
        triggeredBy: userId,
        orderId:     updated.id,
        poNumber:    existing.poNumber,
        fromStatus:  prevStatus,
        toStatus:    'CANCELLED',
      },
    });

    return updated;
  }

  // ── Dispatch order (QC_PASSED → DISPATCHED) ───────────────────────────────

  async dispatchOrder(id: string, tenantId: string, userId: string) {
    const existing = await this.getOrder(id, tenantId);

    if (existing.status !== 'QC_PASSED') {
      throw new BadRequestException(
        `Order must be QC_PASSED to dispatch (current: ${existing.status})`,
      );
    }

    const updated = await (this.prisma as any).order.update({
      where: { id },
      data:  { status: 'DISPATCHED' },
    });

    await this.audit.log({
      tenantId, userId,
      action:    'UPDATE',
      tableName: 'orders',
      recordId:  id,
      oldValues: { status: 'QC_PASSED' },
      newValues: { status: 'DISPATCHED' },
    });

    // ── Kafka: order.status-changed ──────────────────────────────────────────
    await this.kafka.emit(TOPIC_ORDER_STATUS_CHANGED, {
      key: tenantId,
      value: {
        occurredAt:  new Date().toISOString(),
        tenantId,
        triggeredBy: userId,
        orderId:     updated.id,
        poNumber:    existing.poNumber,
        fromStatus:  'QC_PASSED',
        toStatus:    'DISPATCHED',
      },
    });

    return updated;
  }
}
