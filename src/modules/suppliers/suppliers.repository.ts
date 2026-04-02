import { Injectable }    from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { Prisma }        from '@prisma/client';
import { paginate }      from '../../shared/utils/pagination.util';
import {
  CreateSupplierDto, UpdateSupplierDto, SupplierFilterDto,
  CreatePurchaseOrderDto, PoFilterDto,
} from './dto/supplier.dto';

@Injectable()
export class SuppliersRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Suppliers ─────────────────────────────────────────────────────────

  async createSupplier(dto: CreateSupplierDto, tenantId: string) {
    return this.prisma.supplier.create({
      data: {
        tenantId,
        name:          dto.name,
        gstin:         dto.gstin,
        email:         dto.email,
        phone:         dto.phone,
        address:       dto.address,
        contactPerson: dto.contactPerson,
        services:      dto.services ?? [],
      },
    });
  }

  async findSupplierById(id: string, tenantId: string) {
    return this.prisma.supplier.findFirst({
      where: { id, tenantId },
    });
  }

  async findSuppliersWithFilters(filters: SupplierFilterDto, tenantId: string) {
    const where: Prisma.SupplierWhereInput = {
      tenantId,
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
      ...(filters.service  && { services: { has: filters.service } }),
      ...(filters.search   && {
        OR: [
          { name:  { contains: filters.search, mode: 'insensitive' } },
          { email: { contains: filters.search, mode: 'insensitive' } },
          { gstin: { contains: filters.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({
        where,
        orderBy: { [filters.sortBy ?? 'name']: filters.sortDir ?? 'asc' },
        skip:    filters.skip,
        take:    filters.limit,
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return paginate(rows, total, filters);
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto) {
    return this.prisma.supplier.update({ where: { id }, data: dto });
  }

  async updateVendorScore(id: string, score: number) {
    return this.prisma.supplier.update({
      where: { id },
      data:  { vendorScore: score },
    });
  }

  // ── Purchase Orders ───────────────────────────────────────────────────

  async createPo(
    dto:      CreatePurchaseOrderDto,
    tenantId: string,
    userId:   string,
    poNumber: string,
  ) {
    return this.prisma.purchaseOrder.create({
      data: {
        tenantId,
        supplierId:   dto.supplierId,
        poNumber,
        poDate:       new Date(dto.poDate),
        expectedDate: new Date(dto.expectedDate),
        remarks:      dto.remarks,
        createdById:  userId,
        lines: {
          create: dto.lines.map(line => ({
            tenantId,
            itemId:      line.itemId,
            description: line.description,
            qty:         line.qty,
            unit:        line.unit,
            rate:        line.rate,
            hsnCode:     line.hsnCode,
            gstPct:      line.gstPct ?? 18,
            amount:      line.qty * line.rate,
          })),
        },
      },
      include: { lines: true, supplier: true },
    });
  }

  async findPoById(id: string, tenantId: string) {
    return this.prisma.purchaseOrder.findFirst({
      where:   { id, tenantId },
      include: { lines: true, supplier: true },
    });
  }

  async findPosWithFilters(filters: PoFilterDto, tenantId: string) {
    const where: Prisma.PurchaseOrderWhereInput = {
      tenantId,
      ...(filters.supplierId && { supplierId: filters.supplierId }),
      ...(filters.status     && { status:     filters.status }),
      ...(filters.from || filters.to
        ? {
            poDate: {
              ...(filters.from && { gte: new Date(filters.from) }),
              ...(filters.to   && { lte: new Date(filters.to)   }),
            },
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.findMany({
        where,
        include: { supplier: true, lines: true },
        orderBy: { createdAt: 'desc' },
        skip:    filters.skip,
        take:    filters.limit,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return paginate(rows, total, filters);
  }

  async updatePoStatus(id: string, status: string, extra: object = {}) {
    return this.prisma.purchaseOrder.update({
      where: { id },
      data:  { status, ...extra },
    });
  }

  async getPoCount(tenantId: string): Promise<number> {
    return this.prisma.purchaseOrder.count({ where: { tenantId } });
  }
}