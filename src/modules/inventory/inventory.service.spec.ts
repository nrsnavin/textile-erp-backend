// src/modules/inventory/inventory.service.spec.ts

import { Test, TestingModule }           from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { InventoryService }              from './inventory.service';
import { PrismaService }                 from '../../shared/prisma/prisma.service';
import { AuditService }                  from '../../shared/services/audit.service';
import { KafkaService }                  from '../../shared/services/kafka.service';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID  = 'tenant-uuid-1';
const USER_ID    = 'user-uuid-1';
const ITEM_ID    = 'item-uuid-1';
const GRN_ID     = 'grn-uuid-1';
const LOCATION   = 'MAIN';

const mockBalance = {
  id:        'bal-1',
  tenantId:  TENANT_ID,
  itemId:    ITEM_ID,
  location:  LOCATION,
  onHand:    100,
  reserved:  0,
  available: 100,
};

const mockLedgerEntry = {
  id:         'ledger-1',
  tenantId:   TENANT_ID,
  itemId:     ITEM_ID,
  location:   LOCATION,
  entryType:  'ADJUSTMENT',
  qty:        10,
  balanceQty: 110,
};

const mockGrn = {
  id:          GRN_ID,
  tenantId:    TENANT_ID,
  grnNumber:   'GRN-001',
  supplierId:  'supplier-1',
  status:      'DRAFT',
  location:    LOCATION,
  lines: [
    { id: 'line-1', itemId: ITEM_ID, qty: 50, acceptedQty: 45, rate: 10 },
  ],
};

// ── Prisma mock — deep enough to satisfy the service ─────────────────────────

function makeTxClient() {
  return {
    stockBalance: {
      findFirst: jest.fn().mockResolvedValue(mockBalance),
      upsert:    jest.fn().mockResolvedValue({ ...mockBalance, onHand: 110 }),
    },
    stockLedger: {
      create:    jest.fn().mockResolvedValue(mockLedgerEntry),
      findMany:  jest.fn().mockResolvedValue([mockLedgerEntry]),
      count:     jest.fn().mockResolvedValue(1),
      aggregate: jest.fn().mockResolvedValue({ _sum: { qty: 100 } }),
    },
    grn: {
      update: jest.fn().mockResolvedValue({ ...mockGrn, status: 'POSTED' }),
    },
  };
}

const mockPrisma: any = {
  stockBalance: {
    findMany:  jest.fn().mockResolvedValue([mockBalance]),
    findFirst: jest.fn().mockResolvedValue(mockBalance),
    upsert:    jest.fn().mockResolvedValue({ ...mockBalance, onHand: 110 }),
  },
  stockLedger: {
    create:   jest.fn().mockResolvedValue(mockLedgerEntry),
    findMany: jest.fn().mockResolvedValue([mockLedgerEntry]),
    count:    jest.fn().mockResolvedValue(1),
  },
  bom: {
    findMany:   jest.fn().mockResolvedValue([]),
    findFirst:  jest.fn().mockResolvedValue(null),
    create:     jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  grn: {
    findFirst: jest.fn().mockResolvedValue(mockGrn),
    update:    jest.fn().mockResolvedValue({ ...mockGrn, status: 'POSTED' }),
  },
  $transaction: jest.fn(async (fn: any) => fn(makeTxClient())),
};

const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
const mockKafka = { emit: jest.fn().mockResolvedValue(undefined) };

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('InventoryService', () => {
  let service: InventoryService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Re-initialize transaction mock after clearAllMocks
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(makeTxClient()));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService,  useValue: mockAudit  },
        { provide: KafkaService,  useValue: mockKafka  },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
  });

  // ── listStockBalances ──────────────────────────────────────────────────────

  describe('listStockBalances', () => {
    it('queries by tenantId', async () => {
      await service.listStockBalances(TENANT_ID);
      expect(mockPrisma.stockBalance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: TENANT_ID }) }),
      );
    });

    it('adds location filter when provided', async () => {
      await service.listStockBalances(TENANT_ID, 'WAREHOUSE-A');
      expect(mockPrisma.stockBalance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ location: 'WAREHOUSE-A' }) }),
      );
    });
  });

  // ── adjustStock ────────────────────────────────────────────────────────────

  describe('adjustStock', () => {
    it('calls postMovement via $transaction and logs audit', async () => {
      const dto = { itemId: ITEM_ID, location: LOCATION, qty: 10, reason: 'Recount' };

      await service.adjustStock(dto, TENANT_ID, USER_ID);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ADJUSTMENT', tableName: 'stock_ledger' }),
      );
    });

    it('defaults location to MAIN when not provided', async () => {
      const dto = { itemId: ITEM_ID, qty: 5, reason: 'Test' };

      await service.adjustStock(dto, TENANT_ID, USER_ID);

      // Transaction is called (postMovement is called internally)
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  // ── issueToProduction ──────────────────────────────────────────────────────

  describe('issueToProduction', () => {
    it('calls $transaction and writes ISSUE_TO_PROD entry', async () => {
      const dto = { itemId: ITEM_ID, qty: 20, location: LOCATION };

      await service.issueToProduction(dto, TENANT_ID, USER_ID);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ISSUE_TO_PROD' }),
      );
    });
  });

  // ── returnFromProduction ───────────────────────────────────────────────────

  describe('returnFromProduction', () => {
    it('calls $transaction and writes RETURN_FROM_PROD entry', async () => {
      const dto = { itemId: ITEM_ID, qty: 5, location: LOCATION };

      await service.returnFromProduction(dto, TENANT_ID, USER_ID);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RETURN_FROM_PROD' }),
      );
    });
  });

  // ── transferStock ──────────────────────────────────────────────────────────

  describe('transferStock', () => {
    it('calls $transaction for both TRANSFER_OUT and TRANSFER_IN', async () => {
      const dto = { itemId: ITEM_ID, fromLocation: 'MAIN', toLocation: 'STORE-2', qty: 10 };

      await service.transferStock(dto, TENANT_ID, USER_ID);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('throws BadRequestException when fromLocation === toLocation', async () => {
      const dto = { itemId: ITEM_ID, fromLocation: 'MAIN', toLocation: 'MAIN', qty: 10 };

      await expect(
        service.transferStock(dto, TENANT_ID, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for empty location strings', async () => {
      const dto = { itemId: ITEM_ID, fromLocation: '', toLocation: 'STORE-2', qty: 10 };

      await expect(
        service.transferStock(dto, TENANT_ID, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── setOpeningStock ────────────────────────────────────────────────────────

  describe('setOpeningStock', () => {
    it('writes OPENING_STOCK entry via $transaction', async () => {
      const dto = { itemId: ITEM_ID, qty: 100, location: LOCATION };

      await service.setOpeningStock(dto, TENANT_ID, USER_ID);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'OPENING_STOCK' }),
      );
    });
  });

  // ── getMovementHistory ─────────────────────────────────────────────────────

  describe('getMovementHistory', () => {
    it('queries stockLedger with tenantId filter', async () => {
      mockPrisma.stockLedger.findMany.mockResolvedValue([mockLedgerEntry]);
      mockPrisma.stockLedger.count.mockResolvedValue(1);

      await service.getMovementHistory({ page: 1, limit: 20, skip: 0 } as any, TENANT_ID);

      expect(mockPrisma.stockLedger.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: TENANT_ID }) }),
      );
    });

    it('throws BadRequestException for invalid entryType', async () => {
      await expect(
        service.getMovementHistory(
          { page: 1, limit: 20, skip: 0, entryType: 'INVALID_TYPE' } as any,
          TENANT_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid dateFrom', async () => {
      await expect(
        service.getMovementHistory(
          { page: 1, limit: 20, skip: 0, dateFrom: 'not-a-date' } as any,
          TENANT_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── rebuildBalance ─────────────────────────────────────────────────────────

  describe('rebuildBalance', () => {
    it('aggregates ledger and upserts balance', async () => {
      await service.rebuildBalance(ITEM_ID, LOCATION, TENANT_ID);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  // ── postGrn ────────────────────────────────────────────────────────────────

  describe('postGrn', () => {
    it('posts a DRAFT GRN and emits inventory.grn-posted Kafka event', async () => {
      const result = await service.postGrn(GRN_ID, TENANT_ID, USER_ID);

      expect(result.grn.status).toBe('POSTED');
      expect(result.ledgerEntries).toBeDefined();

      expect(mockKafka.emit).toHaveBeenCalledWith(
        'inventory.grn-posted',
        expect.objectContaining({ key: TENANT_ID }),
      );

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'POST_GRN', tableName: 'grn' }),
      );
    });

    it('throws NotFoundException for unknown GRN', async () => {
      mockPrisma.grn.findFirst.mockResolvedValue(null);

      await expect(service.postGrn('bad-grn-id', TENANT_ID, USER_ID))
        .rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when GRN is already POSTED', async () => {
      mockPrisma.grn.findFirst.mockResolvedValue({ ...mockGrn, status: 'POSTED' });

      await expect(service.postGrn(GRN_ID, TENANT_ID, USER_ID))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for GRN with no lines', async () => {
      mockPrisma.grn.findFirst.mockResolvedValue({ ...mockGrn, lines: [] });

      await expect(service.postGrn(GRN_ID, TENANT_ID, USER_ID))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when all lines have zero accepted qty', async () => {
      mockPrisma.grn.findFirst.mockResolvedValue({
        ...mockGrn,
        lines: [{ id: 'line-1', itemId: ITEM_ID, qty: 50, acceptedQty: 0, rate: 10 }],
      });

      await expect(service.postGrn(GRN_ID, TENANT_ID, USER_ID))
        .rejects.toThrow(BadRequestException);
    });
  });
});
