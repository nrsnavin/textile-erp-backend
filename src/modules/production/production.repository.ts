// src/modules/production/production.repository.ts
import { Injectable }    from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  CreateCutOrderDto, UpdateCutOrderDto, CutOrderFilterDto,
  CreateLinePlanDto, UpdateLinePlanDto, LinePlanFilterDto,
  CreateWipRecordDto, UpdateWipRecordDto, WipFilterDto,
} from './dto/production.dto';
import { paginate, dateRangeFilter } from '../../shared/utils/pagination.util';

@Injectable()
export class ProductionRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // CUT ORDERS
  // ═══════════════════════════════════════════════════════════════════════════

  async createCutOrder(dto: CreateCutOrderDto, cutOrderNumber: string, tenantId: string, userId: string) {
    return this.prisma.cutOrder.create({
      data: {
        tenantId,
        orderId:         dto.orderId,
        cutOrderNumber,
        styleCode:       dto.styleCode,
        fabricItemId:    dto.fabricItemId ?? null,
        plannedQty:      dto.plannedQty,
        layers:          dto.layers ?? 1,
        markerLength:    dto.markerLength ?? null,
        plannedDate:     new Date(dto.plannedDate),
        createdById:     userId,
      },
      include: { order: { select: { poNumber: true, buyerId: true } } },
    });
  }

  async findCutOrderById(id: string, tenantId: string) {
    return this.prisma.cutOrder.findFirst({
      where: { id, tenantId },
      include: { order: { select: { poNumber: true, buyerId: true } } },
    });
  }

  async listCutOrders(filters: CutOrderFilterDto, tenantId: string) {
    const where: any = { tenantId };
    if (filters.status)  where.status  = filters.status;
    if (filters.orderId) where.orderId = filters.orderId;
    Object.assign(where, dateRangeFilter('plannedDate', filters.from, filters.to));

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.cutOrder.findMany({
        where,
        include: { order: { select: { poNumber: true } } },
        orderBy: { [filters.sortBy ?? 'createdAt']: filters.sortDir ?? 'desc' },
        skip: filters.skip,
        take: filters.limit,
      }),
      this.prisma.cutOrder.count({ where }),
    ]);
    return paginate(rows, total, filters);
  }

  async updateCutOrder(id: string, tenantId: string, data: Record<string, any>) {
    return this.prisma.cutOrder.update({
      where: { id },
      data,
      include: { order: { select: { poNumber: true } } },
    });
  }

  async nextCutOrderNumber(tenantId: string): Promise<number> {
    const count = await this.prisma.cutOrder.count({ where: { tenantId } });
    return count + 1;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LINE PLANS
  // ═══════════════════════════════════════════════════════════════════════════

  async createLinePlan(dto: CreateLinePlanDto, tenantId: string, userId: string) {
    return this.prisma.linePlan.create({
      data: {
        tenantId,
        orderId:       dto.orderId,
        lineNumber:    dto.lineNumber,
        styleCode:     dto.styleCode,
        targetQty:     dto.targetQty,
        operatorCount: dto.operatorCount ?? 0,
        sam:           dto.sam ?? null,
        planDate:      new Date(dto.planDate),
        shift:         dto.shift ?? 'DAY',
        createdById:   userId,
      },
      include: { order: { select: { poNumber: true } } },
    });
  }

  async findLinePlanById(id: string, tenantId: string) {
    return this.prisma.linePlan.findFirst({
      where: { id, tenantId },
      include: { order: { select: { poNumber: true } } },
    });
  }

  async listLinePlans(filters: LinePlanFilterDto, tenantId: string) {
    const where: any = { tenantId };
    if (filters.status)     where.status     = filters.status;
    if (filters.lineNumber) where.lineNumber = filters.lineNumber;
    if (filters.orderId)    where.orderId    = filters.orderId;
    Object.assign(where, dateRangeFilter('planDate', filters.from, filters.to));

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.linePlan.findMany({
        where,
        include: { order: { select: { poNumber: true } } },
        orderBy: { [filters.sortBy ?? 'planDate']: filters.sortDir ?? 'desc' },
        skip: filters.skip,
        take: filters.limit,
      }),
      this.prisma.linePlan.count({ where }),
    ]);
    return paginate(rows, total, filters);
  }

  async updateLinePlan(id: string, tenantId: string, data: Record<string, any>) {
    return this.prisma.linePlan.update({
      where: { id },
      data,
      include: { order: { select: { poNumber: true } } },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WIP RECORDS
  // ═══════════════════════════════════════════════════════════════════════════

  async createWipRecord(dto: CreateWipRecordDto, tenantId: string, userId: string) {
    return this.prisma.wipRecord.create({
      data: {
        tenantId,
        orderId:     dto.orderId,
        styleCode:   dto.styleCode,
        stage:       dto.stage,
        inputQty:    dto.inputQty,
        outputQty:   dto.outputQty ?? 0,
        rejectQty:   dto.rejectQty ?? 0,
        recordDate:  new Date(dto.recordDate),
        remarks:     dto.remarks ?? null,
        createdById: userId,
      },
      include: { order: { select: { poNumber: true } } },
    });
  }

  async findWipRecordById(id: string, tenantId: string) {
    return this.prisma.wipRecord.findFirst({
      where: { id, tenantId },
      include: { order: { select: { poNumber: true } } },
    });
  }

  async listWipRecords(filters: WipFilterDto, tenantId: string) {
    const where: any = { tenantId };
    if (filters.stage)   where.stage   = filters.stage;
    if (filters.orderId) where.orderId = filters.orderId;
    Object.assign(where, dateRangeFilter('recordDate', filters.from, filters.to));

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.wipRecord.findMany({
        where,
        include: { order: { select: { poNumber: true } } },
        orderBy: { [filters.sortBy ?? 'recordDate']: filters.sortDir ?? 'desc' },
        skip: filters.skip,
        take: filters.limit,
      }),
      this.prisma.wipRecord.count({ where }),
    ]);
    return paginate(rows, total, filters);
  }

  async updateWipRecord(id: string, tenantId: string, data: Record<string, any>) {
    return this.prisma.wipRecord.update({
      where: { id },
      data,
      include: { order: { select: { poNumber: true } } },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DASHBOARD STATS
  // ═══════════════════════════════════════════════════════════════════════════

  async getDashboardStats(tenantId: string) {
    const [
      activeCutOrders,
      runningLines,
      wipByStage,
      todayCutQty,
      todayAchievedQty,
    ] = await this.prisma.$transaction([
      this.prisma.cutOrder.count({
        where: { tenantId, status: { in: ['PLANNED', 'CUTTING'] } },
      }),
      this.prisma.linePlan.count({
        where: { tenantId, status: 'RUNNING' },
      }),
      (this.prisma.wipRecord.groupBy as any)({
        by: ['stage'],
        where: { tenantId },
        _sum: { inputQty: true, outputQty: true, rejectQty: true },
      }),
      this.prisma.cutOrder.aggregate({
        where: {
          tenantId,
          status: { in: ['CUTTING', 'COMPLETED'] },
          plannedDate: {
            gte: new Date(new Date().toISOString().split('T')[0]),
            lt: new Date(new Date(Date.now() + 86400000).toISOString().split('T')[0]),
          },
        },
        _sum: { cutQty: true },
      }),
      this.prisma.linePlan.aggregate({
        where: {
          tenantId,
          status: { in: ['RUNNING', 'COMPLETED'] },
          planDate: {
            gte: new Date(new Date().toISOString().split('T')[0]),
            lt: new Date(new Date(Date.now() + 86400000).toISOString().split('T')[0]),
          },
        },
        _sum: { achievedQty: true },
      }),
    ]);

    return {
      activeCutOrders,
      runningLines,
      wipByStage: wipByStage.map((s: any) => ({
        stage:     s.stage,
        inputQty:  s._sum?.inputQty  ?? 0,
        outputQty: s._sum?.outputQty ?? 0,
        rejectQty: s._sum?.rejectQty ?? 0,
      })),
      todayCutQty:      todayCutQty._sum?.cutQty      ?? 0,
      todayAchievedQty: todayAchievedQty._sum?.achievedQty ?? 0,
    };
  }
}
