import { Test, TestingModule }  from '@nestjs/testing';
import { NotFoundException }    from '@nestjs/common';
import { BuyersService }        from './buyer.service';
import { BuyersRepository }     from './buyer.repositery';
import { AuditService }         from '../../shared/services/audit.service';
import { CreateBuyerDto, UpdateBuyerDto, BuyerFilterDto, PaymentTerms, BuyerSegment } from './dto/buyer.dto';

// ── Shared fixtures ──────────────────────────────────────────────────────────

const TENANT = 'tenant-uuid-1';
const USER   = 'user-uuid-1';

const mockBuyer = {
  id:           'buyer-uuid-1',
  tenantId:     TENANT,
  name:         'Acme Fashion GmbH',
  country:      'DE',
  email:        'buyer@acme.de',
  phone:        '+4930123456',
  currency:     'EUR',
  address:      'Berlin, Germany',
  isActive:     true,
  paymentTerms: PaymentTerms.NET30,
  creditLimit:  50000 as any,  // Prisma Decimal serialises as number in tests
  creditDays:   30,
  taxId:        'DE123456789',
  segment:      BuyerSegment.A,
  website:      'https://acme.de',
  createdAt:    new Date('2026-01-01'),
  updatedAt:    new Date('2026-01-01'),
} as any;

const paginatedResult = {
  data: [mockBuyer],
  meta: { page: 1, limit: 20, total: 1, pages: 1 },
} as any;

// ── Mocks (typed loosely to avoid Prisma Decimal vs number conflicts) ────────

const mockRepo = {
  create:          jest.fn(),
  findById:        jest.fn(),
  findWithFilters: jest.fn(),
  update:          jest.fn(),
  delete:          jest.fn(),
  reactivate:      jest.fn(),
  getStats:        jest.fn(),
};

const mockAudit = {
  log:             jest.fn(),
  getHistory:      jest.fn(),
  getUserActivity: jest.fn(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BuyersService', () => {
  let service: BuyersService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuyersService,
        { provide: BuyersRepository, useValue: mockRepo  },
        { provide: AuditService,     useValue: mockAudit },
      ],
    }).compile();

    service = module.get<BuyersService>(BuyersService);
  });

  // ── listBuyers ─────────────────────────────────────────────────────────

  describe('listBuyers', () => {
    it('returns paginated buyers from repository', async () => {
      mockRepo.findWithFilters.mockResolvedValue(paginatedResult);

      const filters = new BuyerFilterDto();
      const result  = await service.listBuyers(filters, TENANT);

      expect(mockRepo.findWithFilters).toHaveBeenCalledWith(filters, TENANT);
      expect(result).toEqual(paginatedResult);
    });

    it('passes search and filter params to repository', async () => {
      mockRepo.findWithFilters.mockResolvedValue(paginatedResult);

      const filters = Object.assign(new BuyerFilterDto(), {
        search:       'acme',
        country:      'DE',
        segment:      BuyerSegment.A,
        paymentTerms: PaymentTerms.NET30,
        isActive:     true,
      });

      await service.listBuyers(filters, TENANT);

      expect(mockRepo.findWithFilters).toHaveBeenCalledWith(filters, TENANT);
    });
  });

  // ── getBuyer ───────────────────────────────────────────────────────────

  describe('getBuyer', () => {
    it('returns buyer when found', async () => {
      mockRepo.findById.mockResolvedValue(mockBuyer);

      const result = await service.getBuyer('buyer-uuid-1', TENANT);

      expect(mockRepo.findById).toHaveBeenCalledWith('buyer-uuid-1', TENANT);
      expect(result).toEqual(mockBuyer);
    });

    it('throws NotFoundException when buyer does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.getBuyer('missing-id', TENANT))
        .rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException with correct message', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.getBuyer('missing-id', TENANT))
        .rejects.toThrow('Buyer missing-id not found');
    });
  });

  // ── createBuyer ────────────────────────────────────────────────────────

  describe('createBuyer', () => {
    const createDto: CreateBuyerDto = {
      name:         'Acme Fashion GmbH',
      country:      'DE',
      email:        'buyer@acme.de',
      paymentTerms: PaymentTerms.NET30,
      creditLimit:  50000,
      creditDays:   30,
      taxId:        'DE123456789',
      segment:      BuyerSegment.A,
    };

    it('creates buyer and returns it', async () => {
      mockRepo.create.mockResolvedValue(mockBuyer);
      mockAudit.log.mockResolvedValue(undefined);

      const result = await service.createBuyer(createDto, TENANT, USER);

      expect(mockRepo.create).toHaveBeenCalledWith(createDto, TENANT);
      expect(result).toEqual(mockBuyer);
    });

    it('logs a CREATE audit entry', async () => {
      mockRepo.create.mockResolvedValue(mockBuyer);
      mockAudit.log.mockResolvedValue(undefined);

      await service.createBuyer(createDto, TENANT, USER);

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId:  TENANT,
          userId:    USER,
          action:    'CREATE',
          tableName: 'buyers',
          recordId:  mockBuyer.id,
        }),
      );
    });

    it('includes paymentTerms and segment in audit newValues', async () => {
      mockRepo.create.mockResolvedValue(mockBuyer);
      mockAudit.log.mockResolvedValue(undefined);

      await service.createBuyer(createDto, TENANT, USER);

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          newValues: expect.objectContaining({
            paymentTerms: mockBuyer.paymentTerms,
            segment:      mockBuyer.segment,
          }),
        }),
      );
    });
  });

  // ── updateBuyer ────────────────────────────────────────────────────────

  describe('updateBuyer', () => {
    const updateDto: UpdateBuyerDto = { name: 'Acme Updated', creditLimit: 75000 };
    const updatedBuyer = { ...mockBuyer, name: 'Acme Updated', creditLimit: 75000 };

    it('updates and returns the buyer', async () => {
      mockRepo.findById.mockResolvedValue(mockBuyer);
      mockRepo.update.mockResolvedValue(updatedBuyer);
      mockAudit.log.mockResolvedValue(undefined);

      const result = await service.updateBuyer('buyer-uuid-1', updateDto, TENANT, USER);

      expect(mockRepo.update).toHaveBeenCalledWith('buyer-uuid-1', TENANT, updateDto);
      expect(result).toEqual(updatedBuyer);
    });

    it('throws NotFoundException when buyer does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.updateBuyer('bad-id', updateDto, TENANT, USER))
        .rejects.toThrow(NotFoundException);
    });

    it('logs an UPDATE audit entry with old and new name', async () => {
      mockRepo.findById.mockResolvedValue(mockBuyer);
      mockRepo.update.mockResolvedValue(updatedBuyer);
      mockAudit.log.mockResolvedValue(undefined);

      await service.updateBuyer('buyer-uuid-1', updateDto, TENANT, USER);

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action:    'UPDATE',
          oldValues: expect.objectContaining({ name: 'Acme Fashion GmbH' }),
          newValues: expect.objectContaining({ name: 'Acme Updated' }),
        }),
      );
    });
  });

  // ── deleteBuyer ────────────────────────────────────────────────────────

  describe('deleteBuyer', () => {
    it('soft-deletes buyer and returns success message', async () => {
      mockRepo.findById.mockResolvedValue(mockBuyer);
      mockRepo.delete.mockResolvedValue({ ...mockBuyer, isActive: false });
      mockAudit.log.mockResolvedValue(undefined);

      const result = await service.deleteBuyer('buyer-uuid-1', TENANT, USER);

      expect(mockRepo.delete).toHaveBeenCalledWith('buyer-uuid-1', TENANT);
      expect(result).toEqual({ message: 'Buyer deactivated successfully' });
    });

    it('throws NotFoundException when buyer does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.deleteBuyer('bad-id', TENANT, USER))
        .rejects.toThrow(NotFoundException);
    });

    it('logs a DELETE audit entry', async () => {
      mockRepo.findById.mockResolvedValue(mockBuyer);
      mockRepo.delete.mockResolvedValue({ ...mockBuyer, isActive: false });
      mockAudit.log.mockResolvedValue(undefined);

      await service.deleteBuyer('buyer-uuid-1', TENANT, USER);

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action:    'DELETE',
          tableName: 'buyers',
          recordId:  'buyer-uuid-1',
          newValues: { isActive: false },
        }),
      );
    });
  });

  // ── reactivateBuyer ────────────────────────────────────────────────────

  describe('reactivateBuyer', () => {
    const inactiveBuyer = { ...mockBuyer, isActive: false };

    it('reactivates buyer and returns updated record', async () => {
      mockRepo.findById.mockResolvedValue(inactiveBuyer);
      mockRepo.reactivate.mockResolvedValue({ ...inactiveBuyer, isActive: true });
      mockAudit.log.mockResolvedValue(undefined);

      const result = await service.reactivateBuyer('buyer-uuid-1', TENANT, USER);

      expect(mockRepo.reactivate).toHaveBeenCalledWith('buyer-uuid-1', TENANT);
      expect(result).toEqual({ ...inactiveBuyer, isActive: true });
    });

    it('throws NotFoundException when buyer does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.reactivateBuyer('bad-id', TENANT, USER))
        .rejects.toThrow(NotFoundException);
    });

    it('logs an UPDATE audit entry for reactivation', async () => {
      mockRepo.findById.mockResolvedValue(inactiveBuyer);
      mockRepo.reactivate.mockResolvedValue({ ...inactiveBuyer, isActive: true });
      mockAudit.log.mockResolvedValue(undefined);

      await service.reactivateBuyer('buyer-uuid-1', TENANT, USER);

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action:    'UPDATE',
          oldValues: { isActive: false },
          newValues: { isActive: true },
        }),
      );
    });
  });

  // ── getBuyerStats ──────────────────────────────────────────────────────

  describe('getBuyerStats', () => {
    const statsResult = {
      orderCount:   5,
      invoiceCount: 3,
      totalInvoiced: 150000,
      totalPaid:     120000,
      outstanding:   30000,
    };

    it('returns buyer stats with buyerId prefix', async () => {
      mockRepo.findById.mockResolvedValue(mockBuyer);
      mockRepo.getStats.mockResolvedValue(statsResult);

      const result = await service.getBuyerStats('buyer-uuid-1', TENANT);

      expect(mockRepo.getStats).toHaveBeenCalledWith('buyer-uuid-1', TENANT);
      expect(result).toEqual({ buyerId: 'buyer-uuid-1', ...statsResult });
    });

    it('throws NotFoundException when buyer does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.getBuyerStats('bad-id', TENANT))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── getBuyerAuditHistory ───────────────────────────────────────────────

  describe('getBuyerAuditHistory', () => {
    const auditLogs = [
      { id: 'log-1', action: 'CREATE', createdAt: new Date() },
      { id: 'log-2', action: 'UPDATE', createdAt: new Date() },
    ];

    it('returns audit history for an existing buyer', async () => {
      mockRepo.findById.mockResolvedValue(mockBuyer);
      mockAudit.getHistory.mockResolvedValue(auditLogs as any);

      const result = await service.getBuyerAuditHistory('buyer-uuid-1', TENANT);

      expect(mockAudit.getHistory).toHaveBeenCalledWith(TENANT, 'buyers', 'buyer-uuid-1');
      expect(result).toEqual(auditLogs);
    });

    it('throws NotFoundException when buyer does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.getBuyerAuditHistory('bad-id', TENANT))
        .rejects.toThrow(NotFoundException);
    });
  });
});
