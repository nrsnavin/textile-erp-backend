// src/modules/finance/finance.repository.ts
import { Injectable }    from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  CreateInvoiceDto, UpdateInvoiceDto, InvoiceFilterDto,
  CreatePaymentDto, PaymentFilterDto, ArApFilterDto,
  InvoiceType,
} from './dto/finance.dto';
import { paginate, dateRangeFilter } from '../../shared/utils/pagination.util';

@Injectable()
export class FinanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // INVOICES
  // ═══════════════════════════════════════════════════════════════════════════

  async createInvoice(
    dto: CreateInvoiceDto,
    computed: { subtotal: number; gstAmount: number; total: number },
    lineData: Array<{
      description: string;
      hsnCode?: string;
      qty: number;
      rate: number;
      gstPct: number;
      amount: number;
    }>,
    tenantId: string,
    userId: string,
  ) {
    return (this.prisma.invoice.create as any)({
      data: {
        tenantId,
        orderId:     dto.orderId ?? null,
        buyerId:     dto.buyerId ?? null,
        type:        dto.type,
        invoiceNo:   dto.invoiceNo,
        invoiceDate: new Date(dto.invoiceDate),
        dueDate:     new Date(dto.dueDate),
        subtotal:    computed.subtotal,
        gstAmount:   computed.gstAmount,
        total:       computed.total,
        paidAmount:  0,
        currency:    dto.currency ?? 'INR',
        status:      'DRAFT',
        createdById: userId,
        lines: {
          create: lineData.map(l => ({
            tenantId,
            description: l.description,
            hsnCode:     l.hsnCode ?? null,
            qty:         l.qty,
            rate:        l.rate,
            gstPct:      l.gstPct,
            amount:      l.amount,
          })),
        },
      },
      include: { lines: true, buyer: true },
    });
  }

  async findInvoiceById(id: string, tenantId: string) {
    return (this.prisma.invoice.findFirst as any)({
      where: { id, tenantId },
      include: { lines: true, buyer: true, payments: true },
    });
  }

  async findInvoicesWithFilters(filters: InvoiceFilterDto, tenantId: string) {
    const where: any = {
      tenantId,
      ...(filters.status  && { status: filters.status }),
      ...(filters.type    && { type: filters.type }),
      ...(filters.buyerId && { buyerId: filters.buyerId }),
      ...dateRangeFilter('invoiceDate', filters.from, filters.to),
      ...(filters.search && {
        OR: [
          { invoiceNo: { contains: filters.search, mode: 'insensitive' } },
          { buyer: { name: { contains: filters.search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [rows, total] = await this.prisma.$transaction([
      (this.prisma.invoice.findMany as any)({
        where,
        include: { buyer: true, lines: true },
        orderBy: { [filters.sortBy ?? 'invoiceDate']: filters.sortDir ?? 'desc' },
        skip: filters.skip,
        take: filters.limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return paginate(rows, total, filters);
  }

  async updateInvoice(id: string, tenantId: string, data: Record<string, any>) {
    return this.prisma.invoice.update({
      where: { id },
      data,
    });
  }

  async deleteInvoiceLines(invoiceId: string, tenantId: string) {
    return (this.prisma.invoiceLine.deleteMany as any)({
      where: { invoiceId, tenantId },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAYMENTS
  // ═══════════════════════════════════════════════════════════════════════════

  async createPayment(dto: CreatePaymentDto, tenantId: string) {
    return (this.prisma.payment.create as any)({
      data: {
        tenantId,
        invoiceId: dto.invoiceId,
        amount:    dto.amount,
        mode:      dto.mode,
        reference: dto.reference ?? null,
        paidAt:    new Date(dto.paidAt),
      },
      include: { invoice: true },
    });
  }

  async findPaymentById(id: string, tenantId: string) {
    return (this.prisma.payment.findFirst as any)({
      where: { id, tenantId },
      include: { invoice: true },
    });
  }

  async findPaymentsWithFilters(filters: PaymentFilterDto, tenantId: string) {
    const where: any = {
      tenantId,
      ...(filters.invoiceId && { invoiceId: filters.invoiceId }),
      ...(filters.mode      && { mode: filters.mode }),
      ...dateRangeFilter('paidAt', filters.from, filters.to),
    };

    const [rows, total] = await this.prisma.$transaction([
      (this.prisma.payment.findMany as any)({
        where,
        include: { invoice: { select: { id: true, invoiceNo: true, buyerId: true, total: true } } },
        orderBy: { [filters.sortBy ?? 'paidAt']: filters.sortDir ?? 'desc' },
        skip: filters.skip,
        take: filters.limit,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return paginate(rows, total, filters);
  }

  async getInvoicePaymentTotal(invoiceId: string, tenantId: string): Promise<number> {
    const result = await this.prisma.payment.aggregate({
      where: { invoiceId, tenantId },
      _sum: { amount: true },
    });
    return Number(result._sum.amount ?? 0);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AR / AP AGGREGATION
  // ═══════════════════════════════════════════════════════════════════════════

  async getArApSummary(tenantId: string, filters?: ArApFilterDto) {
    const where: any = {
      tenantId,
      status: { notIn: ['CANCELLED', 'DRAFT'] },
      ...(filters?.type    && { type: filters.type }),
      ...(filters?.buyerId && { buyerId: filters.buyerId }),
    };

    const [totals, overdueCount, statusBreakdown] = await this.prisma.$transaction([
      this.prisma.invoice.aggregate({
        where,
        _sum:   { total: true, paidAmount: true, gstAmount: true },
        _count: { id: true },
      }),
      this.prisma.invoice.count({
        where: { ...where, status: 'OVERDUE' },
      }),
      (this.prisma.invoice.groupBy as any)({
        by:      ['status'],
        where,
        orderBy: { status: 'asc' },
        _sum:    { total: true, paidAmount: true },
        _count:  { id: true },
      }),
    ]);

    const totalInvoiced = Number(totals._sum.total      ?? 0);
    const totalPaid     = Number(totals._sum.paidAmount  ?? 0);
    const totalGst      = Number(totals._sum.gstAmount   ?? 0);
    const outstanding   = Math.round((totalInvoiced - totalPaid) * 100) / 100;

    return {
      totalInvoiced,
      totalPaid,
      outstanding,
      totalGst,
      invoiceCount: totals._count.id,
      overdueCount,
      statusBreakdown: (statusBreakdown as any[]).map((s: any) => ({
        status:       s.status,
        count:        s._count?.id ?? 0,
        totalAmount:  Number(s._sum?.total ?? 0),
        paidAmount:   Number(s._sum?.paidAmount ?? 0),
      })),
    };
  }

  async getAgingBuckets(tenantId: string, type?: InvoiceType) {
    const now = new Date();
    const d30  = new Date(now.getTime() - 30  * 86400000);
    const d60  = new Date(now.getTime() - 60  * 86400000);
    const d90  = new Date(now.getTime() - 90  * 86400000);

    const baseWhere: any = {
      tenantId,
      status: { in: ['SENT', 'PARTIAL', 'OVERDUE'] },
      ...(type && { type }),
    };

    const [current, bucket30, bucket60, bucket90plus] = await this.prisma.$transaction([
      // Current (not yet due)
      this.prisma.invoice.aggregate({
        where: { ...baseWhere, dueDate: { gte: now } },
        _sum: { total: true, paidAmount: true },
        _count: { id: true },
      }),
      // 1-30 days overdue
      this.prisma.invoice.aggregate({
        where: { ...baseWhere, dueDate: { lt: now, gte: d30 } },
        _sum: { total: true, paidAmount: true },
        _count: { id: true },
      }),
      // 31-60 days overdue
      this.prisma.invoice.aggregate({
        where: { ...baseWhere, dueDate: { lt: d30, gte: d60 } },
        _sum: { total: true, paidAmount: true },
        _count: { id: true },
      }),
      // 60+ days overdue
      this.prisma.invoice.aggregate({
        where: { ...baseWhere, dueDate: { lt: d60 } },
        _sum: { total: true, paidAmount: true },
        _count: { id: true },
      }),
    ]);

    const outstanding = (agg: any) => {
      const total = Number(agg._sum.total ?? 0);
      const paid  = Number(agg._sum.paidAmount ?? 0);
      return Math.round((total - paid) * 100) / 100;
    };

    return {
      current:    { count: current._count.id,      outstanding: outstanding(current) },
      days1to30:  { count: bucket30._count.id,      outstanding: outstanding(bucket30) },
      days31to60: { count: bucket60._count.id,      outstanding: outstanding(bucket60) },
      days60plus: { count: bucket90plus._count.id,   outstanding: outstanding(bucket90plus) },
    };
  }
}
