// src/modules/orders/orders.controller.spec.ts

import { Test, TestingModule }  from '@nestjs/testing';
import { OrdersController }     from './orders.controller';
import { OrdersService }        from './orders.service';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-1';
const USER_ID   = 'user-1';
const ORDER_ID  = 'order-uuid-1';

const mockOrder = {
  id:       ORDER_ID,
  tenantId: TENANT_ID,
  poNumber: 'PO-001',
  status:   'DRAFT',
};

const pagedResult = {
  data: [mockOrder],
  meta: { page: 1, limit: 20, total: 1, pages: 1 },
};

// ── Mock service ──────────────────────────────────────────────────────────────

const mockOrdersService = {
  listOrders:    jest.fn().mockResolvedValue(pagedResult),
  getOrder:      jest.fn().mockResolvedValue(mockOrder),
  createOrder:   jest.fn().mockResolvedValue(mockOrder),
  updateOrder:   jest.fn().mockResolvedValue(mockOrder),
  confirmOrder:  jest.fn().mockResolvedValue({ ...mockOrder, status: 'CONFIRMED' }),
  cancelOrder:   jest.fn().mockResolvedValue({ ...mockOrder, status: 'CANCELLED' }),
  dispatchOrder: jest.fn().mockResolvedValue({ ...mockOrder, status: 'DISPATCHED' }),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('OrdersController', () => {
  let controller: OrdersController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [{ provide: OrdersService, useValue: mockOrdersService }],
    }).compile();

    controller = module.get<OrdersController>(OrdersController);
  });

  it('listOrders delegates to service with tenantId', async () => {
    const result = await controller.listOrders({} as any, TENANT_ID);
    expect(mockOrdersService.listOrders).toHaveBeenCalledWith({}, TENANT_ID);
    expect(result.data).toHaveLength(1);
  });

  it('getOrder delegates to service', async () => {
    const result = await controller.getOrder(ORDER_ID, TENANT_ID);
    expect(mockOrdersService.getOrder).toHaveBeenCalledWith(ORDER_ID, TENANT_ID);
    expect(result.id).toBe(ORDER_ID);
  });

  it('createOrder passes dto, tenantId, userId', async () => {
    const dto: any = { buyerId: 'buyer-1', poNumber: 'PO-001', deliveryDate: '2026-12-31', lines: [] };
    await controller.createOrder(dto, TENANT_ID, USER_ID);
    expect(mockOrdersService.createOrder).toHaveBeenCalledWith(dto, TENANT_ID, USER_ID);
  });

  it('updateOrder passes id, dto, tenantId, userId', async () => {
    await controller.updateOrder(ORDER_ID, {} as any, TENANT_ID, USER_ID);
    expect(mockOrdersService.updateOrder).toHaveBeenCalledWith(ORDER_ID, {}, TENANT_ID, USER_ID);
  });

  it('confirmOrder returns CONFIRMED status', async () => {
    const result = await controller.confirmOrder(ORDER_ID, TENANT_ID, USER_ID);
    expect(mockOrdersService.confirmOrder).toHaveBeenCalledWith(ORDER_ID, TENANT_ID, USER_ID);
    expect(result.status).toBe('CONFIRMED');
  });

  it('cancelOrder returns CANCELLED status', async () => {
    const result = await controller.cancelOrder(ORDER_ID, TENANT_ID, USER_ID);
    expect(result.status).toBe('CANCELLED');
  });

  it('dispatchOrder returns DISPATCHED status', async () => {
    const result = await controller.dispatchOrder(ORDER_ID, TENANT_ID, USER_ID);
    expect(result.status).toBe('DISPATCHED');
  });
});
