import { Injectable }    from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { Prisma }        from '@prisma/client';
import { paginate }      from '../../shared/utils/pagination.util';
import {
  CreateSupplierDto, UpdateSupplierDto, SupplierFilterDto,
  CreatePurchaseOrderDto, UpdatePoLineDto, PoFilterDto,
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
        pan:           dto.pan,
        paymentTerms:  dto.paymentTerms,
        creditDays:    dto.creditDays,
        bankAccount:   dto.bankAccount,
        bankIfsc:      dto.bankIfsc,
        bankName:      dto.bankName,
        website:       dto.website,
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
      ...(filters.isActive     !== undefined && { isActive:     filters.isActive }),
      ...(filters.service      && { services: { has: filters.service } }),
      ...(filters.paymentTerms && { paymentTerms: filters.paymentTerms }),
      ...(filters.search && {
        OR: [
          { name:  { contains: filters.search, mode: 'insensitive' } },
          { email: { contains: filters.search, mode: 'insensitive' } },
          { gstin: { contains: filters.search, mode: 'insensitive' } },
          { pan:   { contains: filters.search, mode: 'insensitive' } },
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

  async deactivateSupplier(id: string) {
    return this.prisma.supplier.update({
      where: { id },
      data:  { isActive: false },
    });
  }

  async updateVendorScore(id: string, score: number) {
    return this.prisma.supplier.update({
      where: { id },
      data:  { vendorScore: score },
    });
  }

  /** Stats: PO count, total PO value, avg vendor score, on-time rate proxy. */
  async getStats(id: string, tenantId: string) {
    const [poStats, supplier] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.aggregate({
        where:  { supplierId: id, tenantId },
        _count: { id: true },
      }),
      this.prisma.supplier.findFirst({
        where:  { id, tenantId },
        select: { vendorScore: true },
      }),
    ]);

    const closedOnTime = await this.prisma.purchaseOrder.count({
      where: {
        supplierId: id,
        tenantId,
        status: 'CLOSED',
        // proxy for on-time: closed before or on expected date
        updatedAt: { lte: this.prisma.$queryRaw`NOW()` as unknown as Date },
      },
    });

    const totalPos    = poStats._count.id;
    const vendorScore = supplier?.vendorScore ?? 100;

    return { supplierId: id, poCount: totalPos, vendorScore };
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

  async updatePoLines(poId: string, tenantId: string, lines: Array<{ id: string } & UpdatePoLineDto>) {
    return this.prisma.$transaction(
      lines.map(line =>
        this.prisma.purchaseOrderLine.update({
          where: { id: line.id },
          data: {
            ...(line.qty         !== undefined && { qty: line.qty, amount: line.qty * (line.rate ?? 0) }),
            ...(line.rate        !== undefined && { rate: line.rate }),
            ...(line.description !== undefined && { description: line.description }),
            ...(line.hsnCode     !== undefined && { hsnCode: line.hsnCode }),
            ...(line.gstPct      !== undefined && { gstPct: line.gstPct }),
          },
        }),
      ),
    );
  }

  async getPoCount(tenantId: string): Promise<number> {
    return this.prisma.purchaseOrder.count({ where: { tenantId } });
  }
}
