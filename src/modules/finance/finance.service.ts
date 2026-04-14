// src/modules/finance/finance.service.ts
import {
  Injectable, NotFoundException, BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { FinanceRepository } from './finance.repository';
import { GstService }       from './gst/gst.service';
import { EInvoiceService }  from './einvoice/einvoice.service';
import { AuditService }     from '../../shared/services/audit.service';
import {
  CreateInvoiceDto, UpdateInvoiceDto, InvoiceFilterDto,
  CreatePaymentDto, PaymentFilterDto, ArApFilterDto,
  InvoiceStatus, InvoiceType,
} from './dto/finance.dto';
import { GenerateIrnDto, CancelIrnDto } from './einvoice/einvoice.dto';

@Injectable()
export class FinanceService {
  constructor(
    private readonly repo:      FinanceRepository,
    private readonly gst:       GstService,
    private readonly einvoice:  EInvoiceService,
    private readonly audit:     AuditService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // INVOICES
  // ═══════════════════════════════════════════════════════════════════════════

  async listInvoices(filters: InvoiceFilterDto, tenantId: string) {
    return this.repo.findInvoicesWithFilters(filters, tenantId);
  }

  async getInvoice(id: string, tenantId: string) {
    const invoice = await this.repo.findInvoiceById(id, tenantId);
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
    return invoice;
  }

  async createInvoice(dto: CreateInvoiceDto, tenantId: string, userId: string) {
    if (dto.lines.length === 0) {
      throw new BadRequestException('Invoice must have at least one line item');
    }

    // Validate SALES invoices require a buyerId
    if (dto.type === InvoiceType.SALES && !dto.buyerId) {
      throw new BadRequestException('SALES invoices require a buyerId');
    }

    // ── Business rule: Credit limit enforcement ───────────────────────────
    // Before creating a SALES invoice, verify the buyer's outstanding balance
    // plus this invoice would not exceed their credit limit.
    if (dto.type === InvoiceType.SALES && dto.buyerId) {
      await this.enforceCreditLimit(dto.buyerId, tenantId, dto.lines);
    }

    // ── Business rule: Due date must be in the future ─────────────────────
    if (new Date(dto.dueDate) <= new Date(dto.invoiceDate)) {
      throw new BadRequestException('Due date must be after invoice date');
    }

    // Compute GST across all lines
    const isInterState = dto.isInterState ?? false;
    const gstSummary = this.gst.computeInvoiceGst(
      dto.lines.map(l => ({
        qty:     l.qty,
        rate:    l.rate,
        gstPct:  l.gstPct,
        hsnCode: l.hsnCode,
      })),
      isInterState,
    );

    // Build line data with computed amounts
    const lineData = dto.lines.map((l, i) => {
      const breakdown = gstSummary.lineBreakdowns[i];
      const resolvedGstPct = this.gst.resolveRate(l.gstPct, l.hsnCode);
      return {
        description: l.description,
        hsnCode:     l.hsnCode,
        qty:         l.qty,
        rate:        l.rate,
        gstPct:      resolvedGstPct,
        amount:      breakdown.grandTotal,
      };
    });

    const invoice = await this.repo.createInvoice(
      dto,
      {
        subtotal:  gstSummary.subtotal,
        gstAmount: gstSummary.totalGst,
        total:     gstSummary.grandTotal,
      },
      lineData,
      tenantId,
      userId,
    );

    await this.audit.log({
      tenantId, userId,
      action: 'CREATE', tableName: 'invoices', recordId: invoice.id,
      newValues: {
        invoiceNo: invoice.invoiceNo,
        type:      invoice.type,
        total:     Number(invoice.total),
        gstAmount: Number(invoice.gstAmount),
        lineCount: dto.lines.length,
      },
    });

    return {
      ...invoice,
      gstBreakdown: {
        subtotal:  gstSummary.subtotal,
        totalCgst: gstSummary.totalCgst,
        totalSgst: gstSummary.totalSgst,
        totalIgst: gstSummary.totalIgst,
        totalGst:  gstSummary.totalGst,
        grandTotal: gstSummary.grandTotal,
        isInterState,
      },
    };
  }

  async updateInvoice(id: string, dto: UpdateInvoiceDto, tenantId: string, userId: string) {
    const existing = await this.repo.findInvoiceById(id, tenantId);
    if (!existing) throw new NotFoundException(`Invoice ${id} not found`);

    // Only DRAFT invoices can be freely edited
    if (existing.status !== 'DRAFT' && dto.status === undefined) {
      throw new BadRequestException(
        `Cannot edit invoice in ${existing.status} status. Only status transitions are allowed.`,
      );
    }

    // Validate status transitions
    if (dto.status) {
      this.validateStatusTransition(existing.status, dto.status);
    }

    const data: Record<string, any> = {};
    if (dto.dueDate)    data.dueDate   = new Date(dto.dueDate);
    if (dto.status)     data.status    = dto.status;
    if (dto.currency)   data.currency  = dto.currency;
    if (dto.irnNumber)  data.irnNumber = dto.irnNumber;

    const updated = await this.repo.updateInvoice(id, tenantId, data);

    await this.audit.log({
      tenantId, userId,
      action: 'UPDATE', tableName: 'invoices', recordId: id,
      oldValues: { status: existing.status, dueDate: existing.dueDate },
      newValues: { status: updated.status, dueDate: updated.dueDate },
    });

    return updated;
  }

  async cancelInvoice(id: string, tenantId: string, userId: string) {
    const existing = await this.repo.findInvoiceById(id, tenantId);
    if (!existing) throw new NotFoundException(`Invoice ${id} not found`);

    if (existing.status === 'CANCELLED') {
      throw new ConflictException('Invoice is already cancelled');
    }
    if (existing.status === 'PAID') {
      throw new BadRequestException('Cannot cancel a fully paid invoice. Refund first.');
    }

    const totalPaid = await this.repo.getInvoicePaymentTotal(id, tenantId);
    if (totalPaid > 0) {
      throw new BadRequestException(
        `Cannot cancel invoice with ${totalPaid} in recorded payments. Refund first.`,
      );
    }

    const updated = await this.repo.updateInvoice(id, tenantId, { status: 'CANCELLED' });

    await this.audit.log({
      tenantId, userId,
      action: 'UPDATE', tableName: 'invoices', recordId: id,
      oldValues: { status: existing.status },
      newValues: { status: 'CANCELLED' },
    });

    return updated;
  }

  async getInvoiceAuditHistory(id: string, tenantId: string) {
    const invoice = await this.repo.findInvoiceById(id, tenantId);
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
    return this.audit.getHistory(tenantId, 'invoices', id);
  }

  // ── Business rules ───────────────────────────────────────────────────────

  /**
   * Enforce buyer credit limit before creating a SALES invoice.
   * Outstanding = sum(total - paidAmount) of non-cancelled invoices for this buyer.
   * If outstanding + new invoice total > creditLimit → reject.
   */
  private async enforceCreditLimit(
    buyerId: string,
    tenantId: string,
    lines: Array<{ qty: number; rate: number; gstPct?: number; hsnCode?: string }>,
  ) {
    // Estimate new invoice total (rough — before full GST calc)
    const estimatedSubtotal = lines.reduce((sum, l) => sum + l.qty * l.rate, 0);
    const avgGstRate = 12; // conservative estimate
    const estimatedTotal = estimatedSubtotal * (1 + avgGstRate / 100);

    // Fetch buyer credit limit
    const buyer = await this.repo.findBuyerCreditInfo(buyerId, tenantId);
    if (!buyer || !buyer.creditLimit) return; // no limit set → skip

    const creditLimit = Number(buyer.creditLimit);
    if (creditLimit <= 0) return;

    // Fetch current outstanding
    const outstanding = await this.repo.getBuyerOutstanding(buyerId, tenantId);

    if (outstanding + estimatedTotal > creditLimit) {
      throw new BadRequestException(
        `Invoice would exceed buyer credit limit. ` +
        `Limit: ${creditLimit}, outstanding: ${outstanding.toFixed(2)}, ` +
        `new invoice: ~${estimatedTotal.toFixed(2)}, ` +
        `available: ${(creditLimit - outstanding).toFixed(2)}`,
      );
    }
  }

  // ── Status machine ──────────────────────────────────────────────────────

  private validateStatusTransition(current: string, next: string) {
    const transitions: Record<string, string[]> = {
      DRAFT:     ['SENT', 'CANCELLED'],
      SENT:      ['PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED'],
      PARTIAL:   ['PAID', 'OVERDUE', 'CANCELLED'],
      OVERDUE:   ['PARTIAL', 'PAID', 'CANCELLED'],
      PAID:      [],           // terminal state
      CANCELLED: [],           // terminal state
    };

    const allowed = transitions[current] ?? [];
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `Invalid status transition: ${current} → ${next}. Allowed: ${allowed.join(', ') || 'none'}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAYMENTS
  // ═══════════════════════════════════════════════════════════════════════════

  async listPayments(filters: PaymentFilterDto, tenantId: string) {
    return this.repo.findPaymentsWithFilters(filters, tenantId);
  }

  async getPayment(id: string, tenantId: string) {
    const payment = await this.repo.findPaymentById(id, tenantId);
    if (!payment) throw new NotFoundException(`Payment ${id} not found`);
    return payment;
  }

  async recordPayment(dto: CreatePaymentDto, tenantId: string, userId: string) {
    // Validate invoice exists and is payable
    const invoice = await this.repo.findInvoiceById(dto.invoiceId, tenantId);
    if (!invoice) throw new NotFoundException(`Invoice ${dto.invoiceId} not found`);

    if (['CANCELLED', 'DRAFT'].includes(invoice.status)) {
      throw new BadRequestException(
        `Cannot record payment for invoice in ${invoice.status} status`,
      );
    }

    // Check for overpayment
    const currentPaid = await this.repo.getInvoicePaymentTotal(dto.invoiceId, tenantId);
    const invoiceTotal = Number(invoice.total);
    const newTotal = Math.round((currentPaid + dto.amount) * 100) / 100;

    if (newTotal > invoiceTotal) {
      throw new BadRequestException(
        `Payment of ${dto.amount} would exceed invoice total. ` +
        `Invoice: ${invoiceTotal}, already paid: ${currentPaid}, remaining: ${Math.round((invoiceTotal - currentPaid) * 100) / 100}`,
      );
    }

    // Create payment
    const payment = await this.repo.createPayment(dto, tenantId);

    // Update invoice paidAmount and status
    const newStatus = newTotal >= invoiceTotal ? 'PAID' : 'PARTIAL';
    await this.repo.updateInvoice(dto.invoiceId, tenantId, {
      paidAmount: newTotal,
      status:     newStatus,
    });

    await this.audit.log({
      tenantId, userId,
      action: 'CONFIRM_PAYMENT', tableName: 'payments', recordId: payment.id,
      newValues: {
        invoiceId: dto.invoiceId,
        amount:    dto.amount,
        mode:      dto.mode,
        newPaidTotal: newTotal,
        invoiceStatus: newStatus,
      },
    });

    return {
      payment,
      invoiceUpdate: {
        invoiceId: dto.invoiceId,
        paidAmount: newTotal,
        remaining:  Math.round((invoiceTotal - newTotal) * 100) / 100,
        status:     newStatus,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AR / AP
  // ═══════════════════════════════════════════════════════════════════════════

  async getArSummary(tenantId: string, filters?: ArApFilterDto) {
    return this.repo.getArApSummary(tenantId, {
      ...filters,
      type: InvoiceType.SALES,
    });
  }

  async getApSummary(tenantId: string, filters?: ArApFilterDto) {
    return this.repo.getArApSummary(tenantId, {
      ...filters,
      type: InvoiceType.PURCHASE,
    });
  }

  async getAgingReport(tenantId: string, type?: InvoiceType) {
    return this.repo.getAgingBuckets(tenantId, type);
  }

  // ── GST helpers exposed for controller ──────────────────────────────────

  async previewGst(
    lines: Array<{ qty: number; rate: number; gstPct?: number; hsnCode?: string }>,
    isInterState: boolean,
  ) {
    return this.gst.computeInvoiceGst(lines, isInterState);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // E-INVOICE (NIC API)
  // ═══════════════════════════════════════════════════════════════════════════

  async generateEInvoice(dto: GenerateIrnDto, tenantId: string, userId: string) {
    const invoice = await this.repo.findInvoiceById(dto.invoiceId, tenantId);
    if (!invoice) throw new NotFoundException(`Invoice ${dto.invoiceId} not found`);

    if (invoice.irnNumber) {
      throw new ConflictException(
        `Invoice already has IRN: ${invoice.irnNumber}. Cancel the existing IRN first.`,
      );
    }

    if (invoice.status === 'CANCELLED') {
      throw new BadRequestException('Cannot generate IRN for a cancelled invoice');
    }

    const isInterState = dto.isInterState ?? (dto.sellerStateCode !== dto.buyerStateCode);

    // Build NIC payload from invoice data
    const payload = this.einvoice.buildPayload({
      invoice: {
        invoiceNo:   invoice.invoiceNo,
        invoiceDate: invoice.invoiceDate,
        subtotal:    Number(invoice.subtotal),
        gstAmount:   Number(invoice.gstAmount),
        total:       Number(invoice.total),
        lines: (invoice.lines ?? []).map((l: any) => ({
          description: l.description,
          hsnCode:     l.hsnCode,
          qty:         l.qty,
          rate:        Number(l.rate),
          gstPct:      l.gstPct,
          amount:      Number(l.amount),
        })),
      },
      seller: {
        Gstin: dto.sellerGstin,
        LglNm: dto.sellerLegalName,
        TrdNm: dto.sellerTradeName,
        Addr1: dto.sellerAddress,
        Loc:   dto.sellerCity,
        Pin:   dto.sellerPin,
        Stcd:  dto.sellerStateCode,
      },
      buyer: {
        Gstin: dto.buyerGstin,
        LglNm: dto.buyerLegalName,
        TrdNm: dto.buyerTradeName,
        Pos:   dto.placeOfSupply ?? dto.buyerStateCode,
        Addr1: dto.buyerAddress,
        Loc:   dto.buyerCity,
        Pin:   dto.buyerPin,
        Stcd:  dto.buyerStateCode,
      },
      isInterState,
      supplyType: dto.supplyType,
    });

    // Submit to NIC
    const result = await this.einvoice.generateIrn(payload);

    // Store IRN on invoice
    await this.repo.updateInvoice(dto.invoiceId, tenantId, {
      irnNumber: result.Irn,
    });

    // If invoice is still DRAFT, move to SENT
    if (invoice.status === 'DRAFT') {
      await this.repo.updateInvoice(dto.invoiceId, tenantId, { status: 'SENT' });
    }

    await this.audit.log({
      tenantId, userId,
      action: 'GENERATE_EINVOICE', tableName: 'invoices', recordId: dto.invoiceId,
      newValues: {
        irn:   result.Irn,
        ackNo: result.AckNo,
        ackDt: result.AckDt,
      },
    });

    return {
      invoiceId:     dto.invoiceId,
      irn:           result.Irn,
      ackNo:         result.AckNo,
      ackDt:         result.AckDt,
      signedInvoice: result.SignedInvoice,
      signedQRCode:  result.SignedQRCode,
    };
  }

  async cancelEInvoice(dto: CancelIrnDto, tenantId: string, userId: string) {
    const invoice = await this.repo.findInvoiceById(dto.invoiceId, tenantId);
    if (!invoice) throw new NotFoundException(`Invoice ${dto.invoiceId} not found`);

    if (!invoice.irnNumber) {
      throw new BadRequestException('Invoice does not have an IRN to cancel');
    }

    const result = await this.einvoice.cancelIrn(
      invoice.irnNumber,
      dto.reason as '1' | '2' | '3' | '4',
      dto.remark,
    );

    // Clear IRN from invoice
    await this.repo.updateInvoice(dto.invoiceId, tenantId, {
      irnNumber: null,
    });

    await this.audit.log({
      tenantId, userId,
      action: 'UPDATE', tableName: 'invoices', recordId: dto.invoiceId,
      oldValues: { irnNumber: invoice.irnNumber },
      newValues: { irnNumber: null, cancelDate: result.CancelDate },
    });

    return {
      invoiceId:  dto.invoiceId,
      irn:        result.Irn,
      cancelDate: result.CancelDate,
    };
  }

  async getEInvoiceDetails(invoiceId: string, tenantId: string) {
    const invoice = await this.repo.findInvoiceById(invoiceId, tenantId);
    if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found`);

    if (!invoice.irnNumber) {
      return { invoiceId, irn: null, message: 'No IRN generated for this invoice' };
    }

    const details = await this.einvoice.getIrnDetails(invoice.irnNumber);

    return {
      invoiceId,
      irn:           details.Irn,
      ackNo:         details.AckNo,
      ackDt:         details.AckDt,
      signedInvoice: details.SignedInvoice,
      signedQRCode:  details.SignedQRCode,
    };
  }
}
