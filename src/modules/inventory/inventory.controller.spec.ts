// src/modules/inventory/inventory.controller.spec.ts

import { Test, TestingModule } from '@nestjs/testing';
import { InventoryController } from './inventory.controller';
import { InventoryService }    from './inventory.service';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-1';
const USER_ID   = 'user-1';
const ITEM_ID   = 'item-uuid-1';
const GRN_ID    = 'grn-uuid-1';
const LOCATION  = 'MAIN';

const mockBalance = { id: 'bal-1', itemId: ITEM_ID, onHand: 100, available: 100 };
const mockBom     = { id: 'bom-1', itemId: ITEM_ID, version: 1, isActive: true };
const mockLedger  = { id: 'l-1', entryType: 'ADJUSTMENT', qty: 10 };
// postGrn returns { grn: {...}, ledgerEntries: [...] } matching the service shape
const mockGrn     = { grn: { id: GRN_ID, status: 'POSTED' }, ledgerEntries: [mockLedger] };

// ── Mock service ──────────────────────────────────────────────────────────────

const mockInventoryService = {
  listBoms:             jest.fn().mockResolvedValue([mockBom]),
  getBom:               jest.fn().mockResolvedValue(mockBom),
  createBom:            jest.fn().mockResolvedValue(mockBom),
  listStockBalances:    jest.fn().mockResolvedValue([mockBalance]),
  getMovementHistory:   jest.fn().mockResolvedValue({ data: [mockLedger], meta: { total: 1 } }),
  adjustStock:          jest.fn().mockResolvedValue({ ledger: mockLedger }),
  issueToProduction:    jest.fn().mockResolvedValue({ ledger: mockLedger }),
  returnFromProduction: jest.fn().mockResolvedValue({ ledger: mockLedger }),
  transferStock:        jest.fn().mockResolvedValue({ srcLedger: mockLedger, dstLedger: mockLedger }),
  setOpeningStock:      jest.fn().mockResolvedValue({ ledger: mockLedger }),
  rebuildBalance:       jest.fn().mockResolvedValue({ balance: mockBalance }),
  postGrn:              jest.fn().mockResolvedValue(mockGrn),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('InventoryController', () => {
  let controller: InventoryController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [{ provide: InventoryService, useValue: mockInventoryService }],
    }).compile();

    controller = module.get<InventoryController>(InventoryController);
  });

  it('listBoms delegates to service', async () => {
    const result = await controller.listBoms(TENANT_ID);
    expect(mockInventoryService.listBoms).toHaveBeenCalledWith(TENANT_ID);
    expect(result).toEqual([mockBom]);
  });

  it('getBom delegates to service with id and tenantId', async () => {
    const result = await controller.getBom('bom-1', TENANT_ID);
    expect(mockInventoryService.getBom).toHaveBeenCalledWith('bom-1', TENANT_ID);
    expect(result.id).toBe('bom-1');
  });

  it('createBom passes dto, tenantId, userId', async () => {
    const dto: any = { itemId: ITEM_ID, lines: [] };
    await controller.createBom(dto, TENANT_ID, USER_ID);
    expect(mockInventoryService.createBom).toHaveBeenCalledWith(dto, TENANT_ID, USER_ID);
  });

  it('listStockBalances queries by tenantId', async () => {
    const result = await controller.listStockBalances(undefined, TENANT_ID);
    expect(mockInventoryService.listStockBalances).toHaveBeenCalledWith(TENANT_ID, undefined);
    expect(result).toEqual([mockBalance]);
  });

  it('listStockBalances passes location filter', async () => {
    await controller.listStockBalances('WAREHOUSE-A', TENANT_ID);
    expect(mockInventoryService.listStockBalances).toHaveBeenCalledWith(TENANT_ID, 'WAREHOUSE-A');
  });

  it('getMovementHistory delegates filters and tenantId', async () => {
    const filters: any = { page: 1, limit: 20 };
    const result = await controller.getMovementHistory(filters, TENANT_ID);
    expect(mockInventoryService.getMovementHistory).toHaveBeenCalledWith(filters, TENANT_ID);
    expect(result.data).toHaveLength(1);
  });

  it('adjustStock delegates dto, tenantId, userId', async () => {
    const dto: any = { itemId: ITEM_ID, qty: 10, reason: 'Recount', location: LOCATION };
    await controller.adjustStock(dto, TENANT_ID, USER_ID);
    expect(mockInventoryService.adjustStock).toHaveBeenCalledWith(dto, TENANT_ID, USER_ID);
  });

  it('issueToProduction delegates correctly', async () => {
    const dto: any = { itemId: ITEM_ID, qty: 20, location: LOCATION };
    await controller.issueToProduction(dto, TENANT_ID, USER_ID);
    expect(mockInventoryService.issueToProduction).toHaveBeenCalledWith(dto, TENANT_ID, USER_ID);
  });

  it('returnFromProduction delegates correctly', async () => {
    const dto: any = { itemId: ITEM_ID, qty: 5, location: LOCATION };
    await controller.returnFromProduction(dto, TENANT_ID, USER_ID);
    expect(mockInventoryService.returnFromProduction).toHaveBeenCalledWith(dto, TENANT_ID, USER_ID);
  });

  it('transferStock delegates correctly', async () => {
    const dto: any = { itemId: ITEM_ID, fromLocation: 'MAIN', toLocation: 'STORE-2', qty: 10 };
    await controller.transferStock(dto, TENANT_ID, USER_ID);
    expect(mockInventoryService.transferStock).toHaveBeenCalledWith(dto, TENANT_ID, USER_ID);
  });

  it('setOpeningStock delegates correctly', async () => {
    const dto: any = { itemId: ITEM_ID, qty: 100 };
    await controller.setOpeningStock(dto, TENANT_ID, USER_ID);
    expect(mockInventoryService.setOpeningStock).toHaveBeenCalledWith(dto, TENANT_ID, USER_ID);
  });

  it('rebuildBalance delegates correctly', async () => {
    const dto: any = { itemId: ITEM_ID, location: LOCATION };
    await controller.rebuildBalance(dto, TENANT_ID);
    expect(mockInventoryService.rebuildBalance).toHaveBeenCalledWith(ITEM_ID, LOCATION, TENANT_ID);
  });

  it('postGrn delegates grnId, tenantId, userId', async () => {
    const result = await controller.postGrn(GRN_ID, TENANT_ID, USER_ID);
    expect(mockInventoryService.postGrn).toHaveBeenCalledWith(GRN_ID, TENANT_ID, USER_ID);
    expect(result.grn.status).toBe('POSTED');
  });
});
