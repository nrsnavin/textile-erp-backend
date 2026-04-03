import { Test, TestingModule }         from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SuppliersService }            from './suppliers.service';
import { SuppliersRepository }         from './suppliers.repository';
import { AuditService }                from '../../shared/services/audit.service';
import { KafkaService }                from '../../shared/services/kafka.service';
import {
  CreateSupplierDto, UpdateSupplierDto, SupplierFilterDto,
  CreatePurchaseOrderDto, UpdatePoLineDto, PoFilterDto,
  PaymentTerms, SupplierService,
} from './dto/supplier.dto';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT = 'tenant-uuid-1';
const USER   = 'user-uuid-1';

const mockSupplier = {
  id:            'sup-uuid-1',
  tenantId:      TENANT,
  name:          'Fabric World Ltd',
  gstin:         '27AAPFU0939F1ZV',
  email:         'contact@fabricworld.in',
  phone:         '+912212345678',
  address:       'Mumbai, India',
  contactPerson: 'Ravi Kumar',
  services:      [SupplierService.FABRIC, SupplierService.DYEING],
  vendorScore:   90,
  isActive:      true,
  pan:           'AAPFU0939F',
  paymentTerms:  PaymentTerms.NET30,
  creditDays:    30,
  bankAccount:   '1234567890',
  bankIfsc:      'HDFC0001234',
  bankName:      'HDFC Bank',
  website:       'https://fabricworld.in',
  createdAt:     new Date('2026-01-01'),
  updatedAt:     new Date('2026-01-01'),
};

const mockPo = {
  id:           'po-uuid-1',
  tenantId:     TENANT,
  supplierId:   'sup-uuid-1',
  poNumber:     'PO-2026-0001',
  status:       'DRAFT',
  poDate:       new Date('2026-04-01'),
  expectedDate: new Date('2026-05-01'),
  remarks:      'Urgent order',
  sentAt:       null,
  createdById:  USER,
  createdAt:    new Date('2026-04-01'),
  updatedAt:    new Date('2026-04-01'),
  supplier:     mockSupplier,
  lines: [
    {
      id:     'line-uuid-1',
      poId:   'po-uuid-1',
      itemId: 'item-uuid-1',
      qty:    100,
      unit:   'MTR',
      rate:   250,
      amount: 25000,
      gstPct: 18,
    },
  ],
};

const paginatedSuppliers = {
  data: [mockSupplier],
  meta: { page: 1, limit: 20, total: 1, pages: 1 },
};

const paginatedPos = {
  data: [mockPo],
  meta: { page: 1, limit: 20, total: 1, pages: 1 },
};

// ── Mocks (typed loosely to avoid Prisma type conflicts) ────────────────────

const mockRepo = {
  createSupplier:           jest.fn(),
  findSupplierById:         jest.fn(),
  findSuppliersWithFilters: jest.fn(),
  updateSupplier:           jest.fn(),
  deactivateSupplier:       jest.fn(),
  updateVendorScore:        jest.fn(),
  getStats:                 jest.fn(),
  createPo:                 jest.fn(),
  findPoById:               jest.fn(),
  findPosWithFilters:       jest.fn(),
  updatePoStatus:           jest.fn(),
  updatePoLines:            jest.fn(),
  getPoCount:               jest.fn(),
};

const mockAudit = {
  log:             jest.fn(),
  getHistory:      jest.fn(),
  getUserActivity: jest.fn(),
};

const mockKafka = {
  emit:      jest.fn(),
  subscribe: jest.fn(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SuppliersService', () => {
  let service: SuppliersService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppliersService,
        { provide: SuppliersRepository, useValue: mockRepo  },
        { provide: AuditService,        useValue: mockAudit },
        { provide: KafkaService,        useValue: mockKafka },
      ],
    }).compile();

    service = module.get<SuppliersService>(SuppliersService);
  });

  // ── listSuppliers ──────────────────────────────────────────────────────

  describe('listSuppliers', () => {
    it('returns paginated suppliers from repository', async () => {
      mockRepo.findSuppliersWithFilters.mockResolvedValue(paginatedSuppliers);

      const filters = new SupplierFilterDto();
      const result  = await service.listSuppliers(filters, TENANT);

      expect(mockRepo.findSuppliersWithFilters).toHaveBeenCalledWith(filters, TENANT);
      expect(result).toEqual(paginatedSuppliers);
    });

    it('passes service filter to repository', async () => {
      mockRepo.findSuppliersWithFilters.mockResolvedValue(paginatedSuppliers);

      const filters = Object.assign(new SupplierFilterDto(), {
        service:      SupplierService.FABRIC,
        paymentTerms: PaymentTerms.NET30,
        isActive:     true,
      });

      await service.listSuppliers(filters, TENANT);

      expect(mockRepo.findSuppliersWithFilters).toHaveBeenCalledWith(filters, TENANT);
    });
  });

  // ── getSupplier ────────────────────────────────────────────────────────

  describe('getSupplier', () => {
    it('returns supplier when found', async () => {
      mockRepo.findSupplierById.mockResolvedValue(mockSupplier);

      const result = await service.getSupplier('sup-uuid-1', TENANT);

      expect(result).toEqual(mockSupplier);
    });

    it('throws NotFoundException when supplier does not exist', async () => {
      mockRepo.findSupplierById.mockResolvedValue(null);

      await expect(service.getSupplier('bad-id', TENANT))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── createSupplier ─────────────────────────────────────────────────────

  describe('createSupplier', () => {
    const dto: CreateSupplierDto = {
      name:        'Fabric World Ltd',
      gstin:       '27AAPFU0939F1ZV',
      pan:         'AAPFU0939F',
      services:    [SupplierService.FABRIC],
      paymentTerms: PaymentTerms.NET30,
      bankIfsc:    'HDFC0001234',
      bankName:    'HDFC Bank',
    };

    it('creates supplier and returns it', async () => {
      mockRepo.createSupplier.mockResolvedValue(mockSupplier);
      mockAudit.log.mockResolvedValue(undefined);

      const result = await service.createSupplier(dto, TENANT, USER);

      expect(mockRepo.createSupplier).toHaveBeenCalledWith(dto, TENANT);
      expect(result).toEqual(mockSupplier);
    });

    it('logs CREATE audit with gstin and pan', async () => {
      mockRepo.createSupplier.mockResolvedValue(mockSupplier);
      mockAudit.log.mockResolvedValue(undefined);

      await service.createSupplier(dto, TENANT, USER);

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE', tableName: 'suppliers',
          newValues: expect.objectContaining({
            gstin: mockSupplier.gstin,
            pan:   mockSupplier.pan,
          }),
        }),
      );
    });
  });

  // ── updateSupplier ─────────────────────────────────────────────────────

  describe('updateSupplier', () => {
    it('updates and returns supplier', async () => {
      const dto: UpdateSupplierDto = { paymentTerms: PaymentTerms.NET60, creditDays: 60 };
      const updated = { ...mockSupplier, paymentTerms: PaymentTerms.NET60, creditDays: 60 };

      mockRepo.findSupplierById.mockResolvedValue(mockSupplier);
      mockRepo.updateSupplier.mockResolvedValue(updated);
      mockAudit.log.mockResolvedValue(undefined);

      const result = await service.updateSupplier('sup-uuid-1', dto, TENANT, USER);

      expect(mockRepo.updateSupplier).toHaveBeenCalledWith('sup-uuid-1', dto);
      expect(result).toEqual(updated);
    });

    it('throws NotFoundException when supplier not found', async () => {
      mockRepo.findSupplierById.mockResolvedValue(null);

      await expect(service.updateSupplier('bad-id', {}, TENANT, USER))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── deactivateSupplier ─────────────────────────────────────────────────

  describe('deactivateSupplier', () => {
    it('deactivates supplier and returns updated record', async () => {
      const deactivated = { ...mockSupplier, isActive: false };

      mockRepo.findSupplierById.mockResolvedValue(mockSupplier);
      mockRepo.deactivateSupplier.mockResolvedValue(deactivated);
      mockAudit.log.mockResolvedValue(undefined);

      const result = await service.deactivateSupplier('sup-uuid-1', TENANT, USER);

      expect(mockRepo.deactivateSupplier).toHaveBeenCalledWith('sup-uuid-1');
      expect(result).toEqual(deactivated);
    });

    it('throws NotFoundException when supplier not found', async () => {
      mockRepo.findSupplierById.mockResolvedValue(null);

      await expect(service.deactivateSupplier('bad-id', TENANT, USER))
        .rejects.toThrow(NotFoundException);
    });

    it('logs DELETE audit entry', async () => {
      mockRepo.findSupplierById.mockResolvedValue(mockSupplier);
      mockRepo.deactivateSupplier.mockResolvedValue({ ...mockSupplier, isActive: false });
      mockAudit.log.mockResolvedValue(undefined);

      await service.deactivateSupplier('sup-uuid-1', TENANT, USER);

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action:    'DELETE',
          tableName: 'suppliers',
          newValues: { isActive: false },
        }),
      );
    });
  });

  // ── getSupplierStats ───────────────────────────────────────────────────

  describe('getSupplierStats', () => {
    it('returns supplier stats', async () => {
      const stats = { supplierId: 'sup-uuid-1', poCount: 10, vendorScore: 90 };

      mockRepo.findSupplierById.mockResolvedValue(mockSupplier);
      mockRepo.getStats.mockResolvedValue(stats);

      const result = await service.getSupplierStats('sup-uuid-1', TENANT);

      expect(mockRepo.getStats).toHaveBeenCalledWith('sup-uuid-1', TENANT);
      expect(result).toEqual(stats);
    });

    it('throws NotFoundException when supplier not found', async () => {
      mockRepo.findSupplierById.mockResolvedValue(null);

      await expect(service.getSupplierStats('bad-id', TENANT))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── getSupplierAuditHistory ────────────────────────────────────────────

  describe('getSupplierAuditHistory', () => {
    it('returns audit history for an existing supplier', async () => {
      const logs = [{ id: 'log-1', action: 'CREATE' }];

      mockRepo.findSupplierById.mockResolvedValue(mockSupplier);
      mockAudit.getHistory.mockResolvedValue(logs as any);

      const result = await service.getSupplierAuditHistory('sup-uuid-1', TENANT);

      expect(mockAudit.getHistory).toHaveBeenCalledWith(TENANT, 'suppliers', 'sup-uuid-1');
      expect(result).toEqual(logs);
    });

    it('throws NotFoundException when supplier not found', async () => {
      mockRepo.findSupplierById.mockResolvedValue(null);

      await expect(service.getSupplierAuditHistory('bad-id', TENANT))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── createPurchaseOrder ────────────────────────────────────────────────

  describe('createPurchaseOrder', () => {
    const futureDate = new Date();
    futureDate.setMonth(futureDate.getMonth() + 2);

    const dto: CreatePurchaseOrderDto = {
      supplierId:   'sup-uuid-1',
      poDate:       '2026-04-01',
      expectedDate: futureDate.toISOString(),
      lines: [{
        itemId: 'item-uuid-1',
        qty:    100,
        unit:   'MTR',
        rate:   250,
        gstPct: 18,
      }],
    };

    it('creates PO with auto-generated number', async () => {
      mockRepo.findSupplierById.mockResolvedValue(mockSupplier);
      mockRepo.getPoCount.mockResolvedValue(0);
      mockRepo.createPo.mockResolvedValue(mockPo);
      mockAudit.log.mockResolvedValue(undefined);

      const result = await service.createPurchaseOrder(dto, TENANT, USER);

      expect(mockRepo.getPoCount).toHaveBeenCalledWith(TENANT);
      expect(mockRepo.createPo).toHaveBeenCalledWith(
        dto, TENANT, USER,
        expect.stringMatching(/^PO-\d{4}-\d{4}$/),
      );
      expect(result).toEqual(mockPo);
    });

    it('generates PO number with sequential count padded to 4 digits', async () => {
      mockRepo.findSupplierById.mockResolvedValue(mockSupplier);
      mockRepo.getPoCount.mockResolvedValue(5);
      mockRepo.createPo.mockResolvedValue(mockPo);
      mockAudit.log.mockResolvedValue(undefined);

      await service.createPurchaseOrder(dto, TENANT, USER);

      const callArgs = mockRepo.createPo.mock.calls[0];
      expect(callArgs[3]).toMatch(/PO-\d{4}-0006/);
    });

    it('throws BadRequestException when expectedDate is in the past', async () => {
      mockRepo.findSupplierById.mockResolvedValue(mockSupplier);

      const pastDto = { ...dto, expectedDate: '2020-01-01' };

      await expect(service.createPurchaseOrder(pastDto, TENANT, USER))
        .rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when supplier not found', async () => {
      mockRepo.findSupplierById.mockResolvedValue(null);

      await expect(service.createPurchaseOrder(dto, TENANT, USER))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── updatePurchaseOrderLines ───────────────────────────────────────────

  describe('updatePurchaseOrderLines', () => {
    const lines = [{ id: 'line-uuid-1', qty: 200, rate: 275 }];

    it('updates PO lines for a DRAFT PO', async () => {
      mockRepo.findPoById.mockResolvedValue(mockPo);
      mockRepo.updatePoLines.mockResolvedValue([]);
      mockAudit.log.mockResolvedValue(undefined);

      await service.updatePurchaseOrderLines('po-uuid-1', lines, TENANT, USER);

      expect(mockRepo.updatePoLines).toHaveBeenCalledWith('po-uuid-1', TENANT, lines);
    });

    it('throws BadRequestException for non-DRAFT PO', async () => {
      mockRepo.findPoById.mockResolvedValue({ ...mockPo, status: 'SENT' });

      await expect(
        service.updatePurchaseOrderLines('po-uuid-1', lines, TENANT, USER),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when PO not found', async () => {
      mockRepo.findPoById.mockResolvedValue(null);

      await expect(
        service.updatePurchaseOrderLines('bad-id', lines, TENANT, USER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── sendPurchaseOrder ──────────────────────────────────────────────────

  describe('sendPurchaseOrder', () => {
    it('transitions DRAFT → SENT and emits Kafka event', async () => {
      mockRepo.findPoById.mockResolvedValue(mockPo);
      mockRepo.updatePoStatus.mockResolvedValue({ ...mockPo, status: 'SENT' });
      mockKafka.emit.mockResolvedValue(undefined);
      mockAudit.log.mockResolvedValue(undefined);

      const result = await service.sendPurchaseOrder('po-uuid-1', TENANT, USER);

      expect(mockRepo.updatePoStatus).toHaveBeenCalledWith(
        'po-uuid-1', 'SENT', expect.objectContaining({ sentAt: expect.any(Date) }),
      );
      expect(mockKafka.emit).toHaveBeenCalledWith(
        'supplier.po-dispatched',
        expect.objectContaining({
          key:   TENANT,
          value: expect.objectContaining({ eventType: 'PoDispatched', poId: 'po-uuid-1' }),
        }),
      );
      expect(result.status).toBe('SENT');
    });

    it('throws BadRequestException when PO is not DRAFT', async () => {
      mockRepo.findPoById.mockResolvedValue({ ...mockPo, status: 'SENT' });

      await expect(service.sendPurchaseOrder('po-uuid-1', TENANT, USER))
        .rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when PO not found', async () => {
      mockRepo.findPoById.mockResolvedValue(null);

      await expect(service.sendPurchaseOrder('bad-id', TENANT, USER))
        .rejects.toThrow(NotFoundException);
    });

    it('logs SEND_PO audit entry', async () => {
      mockRepo.findPoById.mockResolvedValue(mockPo);
      mockRepo.updatePoStatus.mockResolvedValue({ ...mockPo, status: 'SENT' });
      mockKafka.emit.mockResolvedValue(undefined);
      mockAudit.log.mockResolvedValue(undefined);

      await service.sendPurchaseOrder('po-uuid-1', TENANT, USER);

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action:    'SEND_PO',
          oldValues: { status: 'DRAFT' },
          newValues: { status: 'SENT' },
        }),
      );
    });
  });

  // ── acknowledgePurchaseOrder ───────────────────────────────────────────

  describe('acknowledgePurchaseOrder', () => {
    it('transitions SENT → ACKNOWLEDGED', async () => {
      mockRepo.findPoById.mockResolvedValue({ ...mockPo, status: 'SENT' });
      mockRepo.updatePoStatus.mockResolvedValue({ ...mockPo, status: 'ACKNOWLEDGED' });
      mockAudit.log.mockResolvedValue(undefined);

      const result = await service.acknowledgePurchaseOrder('po-uuid-1', TENANT, USER);

      expect(mockRepo.updatePoStatus).toHaveBeenCalledWith('po-uuid-1', 'ACKNOWLEDGED');
      expect(result.status).toBe('ACKNOWLEDGED');
    });

    it('throws BadRequestException when PO is not SENT', async () => {
      mockRepo.findPoById.mockResolvedValue({ ...mockPo, status: 'DRAFT' });

      await expect(service.acknowledgePurchaseOrder('po-uuid-1', TENANT, USER))
        .rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when PO not found', async () => {
      mockRepo.findPoById.mockResolvedValue(null);

      await expect(service.acknowledgePurchaseOrder('bad-id', TENANT, USER))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── closePurchaseOrder ─────────────────────────────────────────────────

  describe('closePurchaseOrder', () => {
    it('closes an ACKNOWLEDGED PO', async () => {
      mockRepo.findPoById.mockResolvedValue({ ...mockPo, status: 'ACKNOWLEDGED' });
      mockRepo.updatePoStatus.mockResolvedValue({ ...mockPo, status: 'CLOSED' });
      mockAudit.log.mockResolvedValue(undefined);

      const result = await service.closePurchaseOrder('po-uuid-1', TENANT, USER);

      expect(mockRepo.updatePoStatus).toHaveBeenCalledWith('po-uuid-1', 'CLOSED');
      expect(result.status).toBe('CLOSED');
    });

    it('closes a PART_RECEIVED PO', async () => {
      mockRepo.findPoById.mockResolvedValue({ ...mockPo, status: 'PART_RECEIVED' });
      mockRepo.updatePoStatus.mockResolvedValue({ ...mockPo, status: 'CLOSED' });
      mockAudit.log.mockResolvedValue(undefined);

      await service.closePurchaseOrder('po-uuid-1', TENANT, USER);

      expect(mockRepo.updatePoStatus).toHaveBeenCalledWith('po-uuid-1', 'CLOSED');
    });

    it('throws BadRequestException when PO is DRAFT or SENT', async () => {
      mockRepo.findPoById.mockResolvedValue({ ...mockPo, status: 'DRAFT' });

      await expect(service.closePurchaseOrder('po-uuid-1', TENANT, USER))
        .rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when PO not found', async () => {
      mockRepo.findPoById.mockResolvedValue(null);

      await expect(service.closePurchaseOrder('bad-id', TENANT, USER))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── cancelPurchaseOrder ────────────────────────────────────────────────

  describe('cancelPurchaseOrder', () => {
    it.each(['DRAFT', 'SENT', 'ACKNOWLEDGED', 'PART_RECEIVED'])(
      'cancels a %s PO',
      async (status) => {
        mockRepo.findPoById.mockResolvedValue({ ...mockPo, status });
        mockRepo.updatePoStatus.mockResolvedValue({ ...mockPo, status: 'CANCELLED' });
        mockAudit.log.mockResolvedValue(undefined);

        const result = await service.cancelPurchaseOrder('po-uuid-1', TENANT, USER);

        expect(mockRepo.updatePoStatus).toHaveBeenCalledWith('po-uuid-1', 'CANCELLED');
        expect(result.status).toBe('CANCELLED');
      },
    );

    it('throws BadRequestException when PO is already CLOSED', async () => {
      mockRepo.findPoById.mockResolvedValue({ ...mockPo, status: 'CLOSED' });

      await expect(service.cancelPurchaseOrder('po-uuid-1', TENANT, USER))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when PO is already CANCELLED', async () => {
      mockRepo.findPoById.mockResolvedValue({ ...mockPo, status: 'CANCELLED' });

      await expect(service.cancelPurchaseOrder('po-uuid-1', TENANT, USER))
        .rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when PO not found', async () => {
      mockRepo.findPoById.mockResolvedValue(null);

      await expect(service.cancelPurchaseOrder('bad-id', TENANT, USER))
        .rejects.toThrow(NotFoundException);
    });

    it('logs cancel audit entry with old status', async () => {
      mockRepo.findPoById.mockResolvedValue({ ...mockPo, status: 'SENT' });
      mockRepo.updatePoStatus.mockResolvedValue({ ...mockPo, status: 'CANCELLED' });
      mockAudit.log.mockResolvedValue(undefined);

      await service.cancelPurchaseOrder('po-uuid-1', TENANT, USER);

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          oldValues: { status: 'SENT' },
          newValues: { status: 'CANCELLED' },
        }),
      );
    });
  });
});
