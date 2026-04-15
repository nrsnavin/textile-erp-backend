// src/modules/quality/quality.repository.ts
import { Injectable }    from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { paginate }      from '../../shared/utils/pagination.util';
import { CreateQcInspectionDto, UpdateQcInspectionDto, QcFilterDto } from './dto/quality.dto';

@Injectable()
export class QualityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateQcInspectionDto, tenantId: string, userId: string) {
    return (this.prisma as any).qcInspection.create({
      data: {
        tenantId,
        orderId:     dto.orderId,
        styleCode:   dto.styleCode,
        inspectorId: userId,
        inspType:    dto.inspType,
        result:      dto.result,
        aqlLevel:    dto.aqlLevel   ?? null,
        sampleSize:  dto.sampleSize ?? null,
        defectCount: dto.defectCount,
        photoUrls:   dto.photoUrls  ?? [],
        notes:       dto.notes      ?? null,
      },
      include: {
        order: { select: { id: true, poNumber: true, status: true } },
      },
    });
  }

  async findById(id: string, tenantId: string) {
    return (this.prisma as any).qcInspection.findFirst({
      where: { id, tenantId },
      include: {
        order: { select: { id: true, poNumber: true, status: true, buyerId: true } },
      },
    });
  }

  async findMany(filters: QcFilterDto, tenantId: string) {
    const where: any = {
      tenantId,
      ...(filters.orderId   && { orderId:   filters.orderId }),
      ...(filters.styleCode && { styleCode: filters.styleCode }),
      ...(filters.inspType  && { inspType:  filters.inspType }),
      ...(filters.result    && { result:    filters.result }),
    };

    const [rows, total] = await Promise.all([
      (this.prisma as any).qcInspection.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:    filters.skip,
        take:    filters.limit,
        include: {
          order: { select: { id: true, poNumber: true, status: true } },
        },
      }),
      (this.prisma as any).qcInspection.count({ where }),
    ]);

    return paginate(rows, total, filters);
  }

  async update(id: string, tenantId: string, data: Record<string, any>) {
    return (this.prisma as any).qcInspection.update({
      where: { id },
      data,
      include: {
        order: { select: { id: true, poNumber: true, status: true } },
      },
    });
  }

  async getDashboardStats(tenantId: string) {
    const [total, pass, fail, conditional, defectAgg] = await Promise.all([
      (this.prisma as any).qcInspection.count({ where: { tenantId } }),
      (this.prisma as any).qcInspection.count({ where: { tenantId, result: 'PASS' } }),
      (this.prisma as any).qcInspection.count({ where: { tenantId, result: 'FAIL' } }),
      (this.prisma as any).qcInspection.count({ where: { tenantId, result: 'CONDITIONAL' } }),
      (this.prisma as any).qcInspection.aggregate({
        where: { tenantId },
        _avg: { defectCount: true },
      }),
    ]);

    return {
      totalInspections: total,
      passCount:        pass,
      failCount:        fail,
      conditionalCount: conditional,
      passRate:         total > 0 ? Math.round((pass / total) * 10000) / 100 : 0,
      avgDefects:       defectAgg._avg?.defectCount ?? 0,
    };
  }

  async findByOrderId(orderId: string, tenantId: string) {
    return (this.prisma as any).qcInspection.findMany({
      where: { orderId, tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
