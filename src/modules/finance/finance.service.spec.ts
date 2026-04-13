import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { FinanceService }    from './finance.service';
import { FinanceRepository } from './finance.repository';
import { GstService }        from './gst/gst.service';
import { AuditService }      from '../../shared/services/audit.service';
import { InvoiceType, InvoiceStatus, PaymentMode } from './dto/finance.dto';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockRepo = () => ({
  createInvoice:           jest.fn(),
  findInvoiceById:         jest.fn(),
  findInvoicesWithFilters: jest.fn(),
  updateInvoice:           jest.fn(),
  deleteInvoiceLines:      jest.fn(),
  createPayment:           jest.fn(),
  findPaymentById:         jest.fn(),
  findPaymentsWithFilters: jest.fn(),
  getInvoicePaymentTotal:  jest.fn(),
  getArApSummary:          jest.fn(),
  getAgingBuckets:         jest.fn(),
});

const mockAudit = () => ({
  log:        jest.fn(),
  getHistory: jest.fn(),
});

describe('FinanceService', () => {
  let service: FinanceService;
  let repo:    ReturnType<typeof mockRepo>;
  let gst:     GstService;
  let audit:   ReturnType<typeof mockAudit>;

  const tenantId = 'tenant-001';
  const userId   = 'user-001';

  beforeEach(() => {
    repo  = mockRepo();
    gst   = new GstService(); // real GST service — it's pure math
    audit = mockAudit();
    service = new FinanceService(
      repo as any as FinanceRepository,
      gst,
      audit as any as AuditService,
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE INVOICE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('createInvoice', () => {
    const validDto = {
      type:        InvoiceType.SALES,
      buyerId:     'buyer-001',
      invoiceNo:   'INV-001',
      invoiceDate: '2026-04-13',
      dueDate:     '2026-05-13',
      lines: [
        { description: 'Cotton fabric', qty: 100, rate: 250, hsnCode: '5208' },
      ],
    };

    it('creates invoice with auto-computed GST', async () => {
      const fakeInvoice = {
        id: 'inv-001', invoiceNo: 'INV-001', type: 'SALES',
        total: 26250, gstAmount: 1250, status: 'DRAFT',
      };
      repo.createInvoice.mockResolvedValue(fakeInvoice);

      const result = await service.createInvoice(validDto, tenantId, userId);

      expect(repo.createInvoice).toHaveBeenCalledWith(
        validDto,
        { subtotal: 25000, gstAmount: 1250, total: 26250 },
        expect.arrayContaining([
          expect.objectContaining({ description: 'Cotton fabric', gstPct: 5 }),
        ]),
        tenantId,
        userId,
      );

      expect(result.gstBreakdown.subtotal).toBe(25000);
      expect(result.gstBreakdown.totalGst).toBe(1250);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', tableName: 'invoices' }),
      );
    });

    it('throws if lines array is empty', async () => {
      await expect(
        service.createInvoice({ ...validDto, lines: [] }, tenantId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws if SALES invoice has no buyerId', async () => {
      await expect(
        service.createInvoice({ ...validDto, buyerId: undefined }, tenantId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows PURCHASE invoice without buyerId', async () => {
      repo.createInvoice.mockResolvedValue({ id: 'inv-002' });
      await expect(
        service.createInvoice(
          { ...validDto, type: InvoiceType.PURCHASE, buyerId: undefined },
          tenantId,
          userId,
        ),
      ).resolves.toBeDefined();
    });

    it('uses IGST for inter-state invoices', async () => {
      repo.createInvoice.mockResolvedValue({ id: 'inv-003' });

      const result = await service.createInvoice(
        { ...validDto, isInterState: true },
        tenantId,
        userId,
      );

      expect(result.gstBreakdown.isInterState).toBe(true);
      expect(result.gstBreakdown.totalIgst).toBe(1250);
      expect(result.gstBreakdown.totalCgst).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE INVOICE — STATUS MACHINE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('updateInvoice — status transitions', () => {
    it('allows DRAFT → SENT', async () => {
      repo.findInvoiceById.mockResolvedValue({ id: 'i1', status: 'DRAFT' });
      repo.updateInvoice.mockResolvedValue({ id: 'i1', status: 'SENT' });

      const result = await service.updateInvoice(
        'i1', { status: InvoiceStatus.SENT }, tenantId, userId,
      );

      expect(result.status).toBe('SENT');
    });

    it('rejects DRAFT → PAID (must go through SENT)', async () => {
      repo.findInvoiceById.mockResolvedValue({ id: 'i1', status: 'DRAFT' });

      await expect(
        service.updateInvoice('i1', { status: InvoiceStatus.PAID }, tenantId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects transitions from PAID (terminal)', async () => {
      repo.findInvoiceById.mockResolvedValue({ id: 'i1', status: 'PAID' });

      await expect(
        service.updateInvoice('i1', { status: InvoiceStatus.SENT }, tenantId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects transitions from CANCELLED (terminal)', async () => {
      repo.findInvoiceById.mockResolvedValue({ id: 'i1', status: 'CANCELLED' });

      await expect(
        service.updateInvoice('i1', { status: InvoiceStatus.SENT }, tenantId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows SENT → OVERDUE', async () => {
      repo.findInvoiceById.mockResolvedValue({ id: 'i1', status: 'SENT' });
      repo.updateInvoice.mockResolvedValue({ id: 'i1', status: 'OVERDUE' });

      await expect(
        service.updateInvoice('i1', { status: InvoiceStatus.OVERDUE }, tenantId, userId),
      ).resolves.toBeDefined();
    });

    it('rejects editing non-DRAFT invoices (non-status changes)', async () => {
      repo.findInvoiceById.mockResolvedValue({ id: 'i1', status: 'SENT' });

      await expect(
        service.updateInvoice('i1', { dueDate: '2026-06-01' }, tenantId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 404 for missing invoice', async () => {
      repo.findInvoiceById.mockResolvedValue(null);

      await expect(
        service.updateInvoice('missing', { status: InvoiceStatus.SENT }, tenantId, userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CANCEL INVOICE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('cancelInvoice', () => {
    it('cancels an unpaid SENT invoice', async () => {
      repo.findInvoiceById.mockResolvedValue({ id: 'i1', status: 'SENT' });
      repo.getInvoicePaymentTotal.mockResolvedValue(0);
      repo.updateInvoice.mockResolvedValue({ id: 'i1', status: 'CANCELLED' });

      const result = await service.cancelInvoice('i1', tenantId, userId);
      expect(result.status).toBe('CANCELLED');
    });

    it('rejects cancelling already cancelled invoice', async () => {
      repo.findInvoiceById.mockResolvedValue({ id: 'i1', status: 'CANCELLED' });

      await expect(
        service.cancelInvoice('i1', tenantId, userId),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects cancelling PAID invoice', async () => {
      repo.findInvoiceById.mockResolvedValue({ id: 'i1', status: 'PAID' });

      await expect(
        service.cancelInvoice('i1', tenantId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects cancelling invoice with payments', async () => {
      repo.findInvoiceById.mockResolvedValue({ id: 'i1', status: 'SENT' });
      repo.getInvoicePaymentTotal.mockResolvedValue(5000);

      await expect(
        service.cancelInvoice('i1', tenantId, userId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RECORD PAYMENT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('recordPayment', () => {
    const paymentDto = {
      invoiceId: 'inv-001',
      amount:    5000,
      mode:      PaymentMode.BANK_TRANSFER,
      paidAt:    '2026-04-13T10:00:00Z',
    };

    it('records payment and updates invoice to PARTIAL', async () => {
      repo.findInvoiceById.mockResolvedValue({
        id: 'inv-001', status: 'SENT', total: 26250,
      });
      repo.getInvoicePaymentTotal.mockResolvedValue(0);
      repo.createPayment.mockResolvedValue({ id: 'pay-001' });
      repo.updateInvoice.mockResolvedValue({});

      const result = await service.recordPayment(paymentDto, tenantId, userId);

      expect(result.invoiceUpdate.paidAmount).toBe(5000);
      expect(result.invoiceUpdate.status).toBe('PARTIAL');
      expect(repo.updateInvoice).toHaveBeenCalledWith('inv-001', tenantId, {
        paidAmount: 5000,
        status:     'PARTIAL',
      });
    });

    it('marks invoice PAID when fully paid', async () => {
      repo.findInvoiceById.mockResolvedValue({
        id: 'inv-001', status: 'PARTIAL', total: 10000,
      });
      repo.getInvoicePaymentTotal.mockResolvedValue(5000);
      repo.createPayment.mockResolvedValue({ id: 'pay-002' });
      repo.updateInvoice.mockResolvedValue({});

      const result = await service.recordPayment(
        { ...paymentDto, amount: 5000 },
        tenantId,
        userId,
      );

      expect(result.invoiceUpdate.status).toBe('PAID');
      expect(result.invoiceUpdate.remaining).toBe(0);
    });

    it('rejects overpayment', async () => {
      repo.findInvoiceById.mockResolvedValue({
        id: 'inv-001', status: 'SENT', total: 10000,
      });
      repo.getInvoicePaymentTotal.mockResolvedValue(8000);

      await expect(
        service.recordPayment({ ...paymentDto, amount: 3000 }, tenantId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects payment on DRAFT invoice', async () => {
      repo.findInvoiceById.mockResolvedValue({
        id: 'inv-001', status: 'DRAFT', total: 10000,
      });

      await expect(
        service.recordPayment(paymentDto, tenantId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects payment on CANCELLED invoice', async () => {
      repo.findInvoiceById.mockResolvedValue({
        id: 'inv-001', status: 'CANCELLED', total: 10000,
      });

      await expect(
        service.recordPayment(paymentDto, tenantId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 404 for missing invoice', async () => {
      repo.findInvoiceById.mockResolvedValue(null);

      await expect(
        service.recordPayment(paymentDto, tenantId, userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AR / AP
  // ═══════════════════════════════════════════════════════════════════════════

  describe('AR/AP summaries', () => {
    it('getArSummary passes SALES type filter', async () => {
      repo.getArApSummary.mockResolvedValue({ totalInvoiced: 100000 });

      await service.getArSummary(tenantId);

      expect(repo.getArApSummary).toHaveBeenCalledWith(tenantId, {
        type: InvoiceType.SALES,
      });
    });

    it('getApSummary passes PURCHASE type filter', async () => {
      repo.getArApSummary.mockResolvedValue({ totalInvoiced: 50000 });

      await service.getApSummary(tenantId);

      expect(repo.getArApSummary).toHaveBeenCalledWith(tenantId, {
        type: InvoiceType.PURCHASE,
      });
    });
  });
});
