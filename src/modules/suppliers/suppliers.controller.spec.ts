import { Test, TestingModule }  from '@nestjs/testing';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService }    from './suppliers.service';
import {
  CreateSupplierDto, UpdateSupplierDto, SupplierFilterDto,
  CreatePurchaseOrderDto, PoFilterDto,
  PaymentTerms, SupplierService,
} from './dto/supplier.dto';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT = 'tenant-uuid-1';
const USER   = 'user-uuid-1';

const mockSupplier = {
  id:           'sup-uuid-1',
  tenantId:     TENANT,
  name:         'Fabric World Ltd',
  gstin:        '27AAPFU0939F1ZV',
  services:     [SupplierService.FABRIC],
  vendorScore:  90,
  isActive:     true,
  paymentTerms: PaymentTerms.NET30,
  pan:          'AAPFU0939F',
  bankIfsc:     'HDFC0001234',
  createdAt:    new Date('2026-01-01'),
  updatedAt:    new Date('2026-01-01'),
};

const mockPo = {
  id:         'po-uuid-1',
  tenantId:   TENANT,
  supplierId: 'sup-uuid-1',
  poNumber:   'PO-2026-0001',
  status:     'DRAFT',
  poDate:     new Date(),
  lines:      [],
  supplier:   mockSupplier,
};

const paginatedSuppliers = {
  data: [mockSupplier],
  meta: { page: 1, limit: 20, total: 1, pages: 1 },
};

const paginatedPos = {
  data: [mockPo],
  meta: { page: 1, limit: 20, total: 1, pages: 1 },
};

// ── Mock service ──────────────────────────────────────────────────────────────

const mockService = {
  listSuppliers:            jest.fn(),
  getSupplier:              jest.fn(),
  createSupplier:           jest.fn(),
  updateSupplier:           jest.fn(),
  deactivateSupplier:       jest.fn(),
  getSupplierStats:         jest.fn(),
  getSupplierAuditHistory:  jest.fn(),
  listPurchaseOrders:       jest.fn(),
  getPurchaseOrder:         jest.fn(),
  createPurchaseOrder:      jest.fn(),
  updatePurchaseOrderLines: jest.fn(),
  sendPurchaseOrder:        jest.fn(),
  acknowledgePurchaseOrder: jest.fn(),
  closePurchaseOrder:       jest.fn(),
  cancelPurchaseOrder:      jest.fn(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SuppliersController', () => {
  let controller: SuppliersController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SuppliersController],
      providers:   [{ provide: SuppliersService, useValue: mockService }],
    }).compile();

    controller = module.get<SuppliersController>(SuppliersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ── listSuppliers ──────────────────────────────────────────────────────

  describe('listSuppliers', () => {
    it('calls service and returns paginated suppliers', async () => {
      mockService.listSuppliers.mockResolvedValue(paginatedSuppliers);

      const filters = new SupplierFilterDto();
      const result  = await controller.listSuppliers(filters, TENANT);

      expect(mockService.listSuppliers).toHaveBeenCalledWith(filters, TENANT);
      expect(result).toEqual(paginatedSuppliers);
    });

    it('passes service and paymentTerms filters to service', async () => {
      mockService.listSuppliers.mockResolvedValue(paginatedSuppliers);

      const filters = Object.assign(new SupplierFilterDto(), {
        service:      SupplierService.FABRIC,
        paymentTerms: PaymentTerms.NET30,
      });

      await controller.listSuppliers(filters, TENANT);

      expect(mockService.listSuppliers).toHaveBeenCalledWith(
        expect.objectContaining({ service: SupplierService.FABRIC }),
        TENANT,
      );
    });
  });

  // ── getSupplier ────────────────────────────────────────────────────────

  describe('getSupplier', () => {
    it('returns supplier from service', async () => {
      mockService.getSupplier.mockResolvedValue(mockSupplier);

      const result = await controller.getSupplier('sup-uuid-1', TENANT);

      expect(mockService.getSupplier).toHaveBeenCalledWith('sup-uuid-1', TENANT);
      expect(result).toEqual(mockSupplier);
    });
  });

  // ── getSupplierStats ───────────────────────────────────────────────────

  describe('getSupplierStats', () => {
    it('returns stats from service', async () => {
      const stats = { supplierId: 'sup-uuid-1', poCount: 10, vendorScore: 90 };
      mockService.getSupplierStats.mockResolvedValue(stats);

      const result = await controller.getSupplierStats('sup-uuid-1', TENANT);

      expect(mockService.getSupplierStats).toHaveBeenCalledWith('sup-uuid-1', TENANT);
      expect(result).toEqual(stats);
    });
  });

  // ── getSupplierAuditHistory ────────────────────────────────────────────

  describe('getSupplierAuditHistory', () => {
    it('returns audit logs from service', async () => {
      const logs = [{ id: 'log-1', action: 'CREATE' }];
      mockService.getSupplierAuditHistory.mockResolvedValue(logs as any);

      const result = await controller.getSupplierAuditHistory('sup-uuid-1', TENANT);

      expect(mockService.getSupplierAuditHistory).toHaveBeenCalledWith('sup-uuid-1', TENANT);
      expect(result).toEqual(logs);
    });
  });

  // ── createSupplier ─────────────────────────────────────────────────────

  describe('createSupplier', () => {
    it('calls service with dto and returns created supplier', async () => {
      const dto: CreateSupplierDto = {
        name:        'Fabric World Ltd',
        pan:         'AAPFU0939F',
        paymentTerms: PaymentTerms.NET30,
        services:    [SupplierService.FABRIC],
      };

      mockService.createSupplier.mockResolvedValue(mockSupplier);

      const result = await controller.createSupplier(dto, TENANT, USER);

      expect(mockService.createSupplier).toHaveBeenCalledWith(dto, TENANT, USER);
      expect(result).toEqual(mockSupplier);
    });
  });

  // ── updateSupplier ─────────────────────────────────────────────────────

  describe('updateSupplier', () => {
    it('calls service update and returns updated supplier', async () => {
      const dto: UpdateSupplierDto = { paymentTerms: PaymentTerms.NET60, bankName: 'HDFC Bank' };
      const updated = { ...mockSupplier, paymentTerms: PaymentTerms.NET60 };

      mockService.updateSupplier.mockResolvedValue(updated);

      const result = await controller.updateSupplier('sup-uuid-1', dto, TENANT, USER);

      expect(mockService.updateSupplier).toHaveBeenCalledWith('sup-uuid-1', dto, TENANT, USER);
      expect(result).toEqual(updated);
    });
  });

  // ── deactivateSupplier ─────────────────────────────────────────────────

  describe('deactivateSupplier', () => {
    it('calls service deactivate', async () => {
      const deactivated = { ...mockSupplier, isActive: false };
      mockService.deactivateSupplier.mockResolvedValue(deactivated);

      const result = await controller.deactivateSupplier('sup-uuid-1', TENANT, USER);

      expect(mockService.deactivateSupplier).toHaveBeenCalledWith('sup-uuid-1', TENANT, USER);
      expect(result).toEqual(deactivated);
    });
  });

  // ── listPurchaseOrders ─────────────────────────────────────────────────

  describe('listPurchaseOrders', () => {
    it('returns paginated purchase orders', async () => {
      mockService.listPurchaseOrders.mockResolvedValue(paginatedPos);

      const filters = new PoFilterDto();
      const result  = await controller.listPurchaseOrders(filters, TENANT);

      expect(mockService.listPurchaseOrders).toHaveBeenCalledWith(filters, TENANT);
      expect(result).toEqual(paginatedPos);
    });
  });

  // ── getPurchaseOrder ───────────────────────────────────────────────────

  describe('getPurchaseOrder', () => {
    it('returns PO from service', async () => {
      mockService.getPurchaseOrder.mockResolvedValue(mockPo);

      const result = await controller.getPurchaseOrder('po-uuid-1', TENANT);

      expect(mockService.getPurchaseOrder).toHaveBeenCalledWith('po-uuid-1', TENANT);
      expect(result).toEqual(mockPo);
    });
  });

  // ── createPurchaseOrder ────────────────────────────────────────────────

  describe('createPurchaseOrder', () => {
    it('calls service and returns created PO', async () => {
      const dto: CreatePurchaseOrderDto = {
        supplierId:   'sup-uuid-1',
        poDate:       '2026-04-01',
        expectedDate: '2026-06-01',
        lines: [{
          itemId: 'item-uuid-1',
          qty:    100,
          unit:   'MTR',
          rate:   250,
        }],
      };

      mockService.createPurchaseOrder.mockResolvedValue(mockPo);

      const result = await controller.createPurchaseOrder(dto, TENANT, USER);

      expect(mockService.createPurchaseOrder).toHaveBeenCalledWith(dto, TENANT, USER);
      expect(result).toEqual(mockPo);
    });
  });

  // ── updatePurchaseOrderLines ───────────────────────────────────────────

  describe('updatePurchaseOrderLines', () => {
    it('calls service updatePurchaseOrderLines', async () => {
      const lines = [{ id: 'line-uuid-1', qty: 200 }];
      mockService.updatePurchaseOrderLines.mockResolvedValue([]);

      await controller.updatePurchaseOrderLines('po-uuid-1', lines, TENANT, USER);

      expect(mockService.updatePurchaseOrderLines).toHaveBeenCalledWith(
        'po-uuid-1', lines, TENANT, USER,
      );
    });
  });

  // ── sendPurchaseOrder ──────────────────────────────────────────────────

  describe('sendPurchaseOrder', () => {
    it('calls service send and returns updated PO', async () => {
      const sent = { ...mockPo, status: 'SENT' };
      mockService.sendPurchaseOrder.mockResolvedValue(sent);

      const result = await controller.sendPurchaseOrder('po-uuid-1', TENANT, USER);

      expect(mockService.sendPurchaseOrder).toHaveBeenCalledWith('po-uuid-1', TENANT, USER);
      expect(result).toEqual(sent);
    });
  });

  // ── acknowledgePurchaseOrder ───────────────────────────────────────────

  describe('acknowledgePurchaseOrder', () => {
    it('calls service acknowledge', async () => {
      const ack = { ...mockPo, status: 'ACKNOWLEDGED' };
      mockService.acknowledgePurchaseOrder.mockResolvedValue(ack);

      const result = await controller.acknowledgePurchaseOrder('po-uuid-1', TENANT, USER);

      expect(mockService.acknowledgePurchaseOrder).toHaveBeenCalledWith('po-uuid-1', TENANT, USER);
      expect(result).toEqual(ack);
    });
  });

  // ── closePurchaseOrder ─────────────────────────────────────────────────

  describe('closePurchaseOrder', () => {
    it('calls service close', async () => {
      const closed = { ...mockPo, status: 'CLOSED' };
      mockService.closePurchaseOrder.mockResolvedValue(closed);

      const result = await controller.closePurchaseOrder('po-uuid-1', TENANT, USER);

      expect(mockService.closePurchaseOrder).toHaveBeenCalledWith('po-uuid-1', TENANT, USER);
      expect(result).toEqual(closed);
    });
  });

  // ── cancelPurchaseOrder ────────────────────────────────────────────────

  describe('cancelPurchaseOrder', () => {
    it('calls service cancel and returns cancelled PO', async () => {
      const cancelled = { ...mockPo, status: 'CANCELLED' };
      mockService.cancelPurchaseOrder.mockResolvedValue(cancelled);

      const result = await controller.cancelPurchaseOrder('po-uuid-1', TENANT, USER);

      expect(mockService.cancelPurchaseOrder).toHaveBeenCalledWith('po-uuid-1', TENANT, USER);
      expect(result).toEqual(cancelled);
    });
  });
});
