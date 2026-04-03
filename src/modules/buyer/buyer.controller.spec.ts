import { Test, TestingModule } from '@nestjs/testing';
import { BuyersController }    from './buyer.controller';
import { BuyersService }       from './buyer.service';
import { CreateBuyerDto, UpdateBuyerDto, BuyerFilterDto, PaymentTerms, BuyerSegment } from './dto/buyer.dto';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT = 'tenant-uuid-1';
const USER   = 'user-uuid-1';

const mockBuyer = {
  id:           'buyer-uuid-1',
  tenantId:     TENANT,
  name:         'Acme Fashion GmbH',
  country:      'DE',
  email:        'buyer@acme.de',
  currency:     'EUR',
  isActive:     true,
  paymentTerms: PaymentTerms.NET30,
  creditLimit:  50000,
  segment:      BuyerSegment.A,
  createdAt:    new Date('2026-01-01'),
  updatedAt:    new Date('2026-01-01'),
};

const paginatedResult = {
  data: [mockBuyer],
  meta: { page: 1, limit: 20, total: 1, pages: 1 },
};

// ── Mock service ──────────────────────────────────────────────────────────────

const mockService = {
  listBuyers:           jest.fn(),
  getBuyer:             jest.fn(),
  createBuyer:          jest.fn(),
  updateBuyer:          jest.fn(),
  deleteBuyer:          jest.fn(),
  reactivateBuyer:      jest.fn(),
  getBuyerStats:        jest.fn(),
  getBuyerAuditHistory: jest.fn(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BuyersController', () => {
  let controller: BuyersController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BuyersController],
      providers:   [{ provide: BuyersService, useValue: mockService }],
    }).compile();

    controller = module.get<BuyersController>(BuyersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ── listBuyers ─────────────────────────────────────────────────────────

  describe('listBuyers', () => {
    it('calls service with filters and tenantId, returns paginated result', async () => {
      mockService.listBuyers.mockResolvedValue(paginatedResult);

      const filters = new BuyerFilterDto();
      const result  = await controller.listBuyers(filters, TENANT);

      expect(mockService.listBuyers).toHaveBeenCalledWith(filters, TENANT);
      expect(result).toEqual(paginatedResult);
    });

    it('passes segment and paymentTerms filters to service', async () => {
      mockService.listBuyers.mockResolvedValue(paginatedResult);

      const filters = Object.assign(new BuyerFilterDto(), {
        segment:      BuyerSegment.A,
        paymentTerms: PaymentTerms.NET30,
        country:      'DE',
      });

      await controller.listBuyers(filters, TENANT);

      expect(mockService.listBuyers).toHaveBeenCalledWith(
        expect.objectContaining({ segment: BuyerSegment.A, paymentTerms: PaymentTerms.NET30 }),
        TENANT,
      );
    });
  });

  // ── getBuyer ───────────────────────────────────────────────────────────

  describe('getBuyer', () => {
    it('calls service with id and tenantId', async () => {
      mockService.getBuyer.mockResolvedValue(mockBuyer);

      const result = await controller.getBuyer('buyer-uuid-1', TENANT);

      expect(mockService.getBuyer).toHaveBeenCalledWith('buyer-uuid-1', TENANT);
      expect(result).toEqual(mockBuyer);
    });
  });

  // ── getBuyerStats ──────────────────────────────────────────────────────

  describe('getBuyerStats', () => {
    it('returns stats from service', async () => {
      const stats = {
        buyerId:      'buyer-uuid-1',
        orderCount:   5,
        invoiceCount: 3,
        totalInvoiced: 150000,
        totalPaid:     120000,
        outstanding:   30000,
      };
      mockService.getBuyerStats.mockResolvedValue(stats);

      const result = await controller.getBuyerStats('buyer-uuid-1', TENANT);

      expect(mockService.getBuyerStats).toHaveBeenCalledWith('buyer-uuid-1', TENANT);
      expect(result).toEqual(stats);
    });
  });

  // ── getBuyerAuditHistory ───────────────────────────────────────────────

  describe('getBuyerAuditHistory', () => {
    it('returns audit logs from service', async () => {
      const logs = [{ id: 'log-1', action: 'CREATE' }];
      mockService.getBuyerAuditHistory.mockResolvedValue(logs as any);

      const result = await controller.getBuyerAuditHistory('buyer-uuid-1', TENANT);

      expect(mockService.getBuyerAuditHistory).toHaveBeenCalledWith('buyer-uuid-1', TENANT);
      expect(result).toEqual(logs);
    });
  });

  // ── createBuyer ────────────────────────────────────────────────────────

  describe('createBuyer', () => {
    it('calls service with dto, tenantId, userId and returns created buyer', async () => {
      const dto: CreateBuyerDto = {
        name:         'Acme Fashion GmbH',
        country:      'DE',
        paymentTerms: PaymentTerms.NET30,
        creditLimit:  50000,
        segment:      BuyerSegment.A,
      };

      mockService.createBuyer.mockResolvedValue(mockBuyer);

      const result = await controller.createBuyer(dto, TENANT, USER);

      expect(mockService.createBuyer).toHaveBeenCalledWith(dto, TENANT, USER);
      expect(result).toEqual(mockBuyer);
    });
  });

  // ── updateBuyer ────────────────────────────────────────────────────────

  describe('updateBuyer', () => {
    it('calls service with id, dto, tenantId, userId', async () => {
      const dto: UpdateBuyerDto = { name: 'Updated Name', creditLimit: 75000 };
      const updated = { ...mockBuyer, name: 'Updated Name', creditLimit: 75000 };

      mockService.updateBuyer.mockResolvedValue(updated);

      const result = await controller.updateBuyer('buyer-uuid-1', dto, TENANT, USER);

      expect(mockService.updateBuyer).toHaveBeenCalledWith('buyer-uuid-1', dto, TENANT, USER);
      expect(result).toEqual(updated);
    });
  });

  // ── reactivateBuyer ────────────────────────────────────────────────────

  describe('reactivateBuyer', () => {
    it('calls service reactivate and returns reactivated buyer', async () => {
      const reactivated = { ...mockBuyer, isActive: true };
      mockService.reactivateBuyer.mockResolvedValue(reactivated);

      const result = await controller.reactivateBuyer('buyer-uuid-1', TENANT, USER);

      expect(mockService.reactivateBuyer).toHaveBeenCalledWith('buyer-uuid-1', TENANT, USER);
      expect(result).toEqual(reactivated);
    });
  });

  // ── deleteBuyer ────────────────────────────────────────────────────────

  describe('deleteBuyer', () => {
    it('calls service delete and returns success message', async () => {
      mockService.deleteBuyer.mockResolvedValue({ message: 'Buyer deactivated successfully' });

      const result = await controller.deleteBuyer('buyer-uuid-1', TENANT, USER);

      expect(mockService.deleteBuyer).toHaveBeenCalledWith('buyer-uuid-1', TENANT, USER);
      expect(result).toEqual({ message: 'Buyer deactivated successfully' });
    });
  });
});
