// src/modules/orders/orders.service.spec.ts

import { Test, TestingModule }           from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { OrdersService }                 from './orders.service';
import { PrismaService }                 from '../../shared/prisma/prisma.service';
import { AuditService }                  from '../../shared/services/audit.service';
import { KafkaService }                  from '../../shared/services/kafka.service';
import { CreateOrderDto }                from './dto/order.dto';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid-1';
const USER_ID   = 'user-uuid-1';
const ORDER_ID  = 'order-uuid-1';

const mockLines = [
  { styleCode: 'TSH-001', itemId: 'item-1', qty: 50, sizesJson: { S: 10, M: 20, L: 20 } },
  { styleCode: 'TSH-002', itemId: 'item-2', qty: 30, sizesJson: { S: 10, M: 20 } },
];

const mockOrder = {
  id:           ORDER_ID,
  tenantId:     TENANT_ID,
  poNumber:     'PO-001',
  buyerId:      'buyer-1',
  buyer:        { id: 'buyer-1', name: 'ACME Corp', country: 'UK' },
  status:       'DRAFT',
  deliveryDate: '2026-12-31',
  season:       null,
  remarks:      null,
  totalQty:     80,
  totalStyles:  2,
  linesJson:    mockLines,
  revision:     1,
  createdById:  USER_ID,
  lines:        mockLines,
  revisions:    [],
  createdAt:    new Date('2026-04-01'),
};

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  order: {
    findMany:  jest.fn(),
    findFirst: jest.fn(),
    create:    jest.fn(),
    update:    jest.fn(),
    count:     jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockAudit  = { log: jest.fn() };
const mockKafka  = { emit: jest.fn().mockResolvedValue(undefined) };

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('OrdersService', () => {
  let service: OrdersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAudit.log.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService,  useValue: mockAudit  },
        { provide: KafkaService,  useValue: mockKafka  },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  // ── listOrders ─────────────────────────────────────────────────────────────

  describe('listOrders', () => {
    it('returns paginated list with defaults', async () => {
      mockPrisma.order.findMany.mockResolvedValue([mockOrder]);
      mockPrisma.order.count.mockResolvedValue(1);

      const result = await service.listOrders({ page: 1, limit: 20, skip: 0 } as any, TENANT_ID);

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT_ID } }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('filters by status', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);
      mockPrisma.order.count.mockResolvedValue(0);

      await service.listOrders(
        { page: 1, limit: 20, skip: 0, status: 'CONFIRMED' } as any,
        TENANT_ID,
      );

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'CONFIRMED' }) }),
      );
    });

    it('applies search on poNumber, season, remarks', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);
      mockPrisma.order.count.mockResolvedValue(0);

      await service.listOrders(
        { page: 1, limit: 20, skip: 0, search: 'PO-001' } as any,
        TENANT_ID,
      );

      const call = mockPrisma.order.findMany.mock.calls[0][0];
      expect(call.where.OR).toBeDefined();
      expect(call.where.OR[0]).toMatchObject({ poNumber: { contains: 'PO-001' } });
    });
  });

  // ── getOrder ───────────────────────────────────────────────────────────────

  describe('getOrder', () => {
    it('returns the order when found', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(mockOrder);

      const result = await service.getOrder(ORDER_ID, TENANT_ID);
      expect(result.id).toBe(ORDER_ID);
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(null);

      await expect(service.getOrder('bad-id', TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ── createOrder ────────────────────────────────────────────────────────────

  describe('createOrder', () => {
    const dto: CreateOrderDto = {
      buyerId:      'buyer-1',
      poNumber:     'PO-001',
      deliveryDate: '2026-12-31',
      lines:        mockLines as any,
    };

    it('creates order with correct aggregates', async () => {
      mockPrisma.order.create.mockResolvedValue({
        ...mockOrder,
        buyer: { id: 'buyer-1', name: 'ACME Corp' },
      });

      const result = await service.createOrder(dto, TENANT_ID, USER_ID);

      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId:    TENANT_ID,
            totalQty:    80,
            totalStyles: 2,
            status:      'DRAFT',
          }),
        }),
      );
      expect(result.id).toBe(ORDER_ID);
    });

    it('logs a CREATE audit entry', async () => {
      mockPrisma.order.create.mockResolvedValue(mockOrder);

      await service.createOrder(dto, TENANT_ID, USER_ID);

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', tableName: 'orders' }),
      );
    });
  });

  // ── updateOrder ────────────────────────────────────────────────────────────

  describe('updateOrder', () => {
    it('throws BadRequestException for CANCELLED orders', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({ ...mockOrder, status: 'CANCELLED' });

      await expect(
        service.updateOrder(ORDER_ID, {} as any, TENANT_ID, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for DISPATCHED orders', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({ ...mockOrder, status: 'DISPATCHED' });

      await expect(
        service.updateOrder(ORDER_ID, {} as any, TENANT_ID, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates order and creates revision snapshot', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(mockOrder);
      mockPrisma.order.update.mockResolvedValue({ ...mockOrder, revision: 2 });

      const result = await service.updateOrder(
        ORDER_ID,
        { deliveryDate: '2027-01-31', lines: [] } as any,
        TENANT_ID,
        USER_ID,
      );

      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ revision: { increment: 1 } }),
        }),
      );
      expect(result.revision).toBe(2);
    });
  });

  // ── confirmOrder ───────────────────────────────────────────────────────────

  describe('confirmOrder', () => {
    it('transitions DRAFT → CONFIRMED and emits Kafka events', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(mockOrder);
      mockPrisma.order.update.mockResolvedValue({
        ...mockOrder,
        status: 'CONFIRMED',
        buyer: { id: 'buyer-1', name: 'ACME Corp', country: 'UK' },
      });

      const result = await service.confirmOrder(ORDER_ID, TENANT_ID, USER_ID);

      expect(result.status).toBe('CONFIRMED');
      expect(mockKafka.emit).toHaveBeenCalledWith(
        'order.confirmed',
        expect.objectContaining({ key: TENANT_ID }),
      );
      expect(mockKafka.emit).toHaveBeenCalledWith(
        'order.status-changed',
        expect.objectContaining({
          value: expect.objectContaining({ fromStatus: 'DRAFT', toStatus: 'CONFIRMED' }),
        }),
      );
    });

    it('throws BadRequestException when order is not DRAFT', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({ ...mockOrder, status: 'CONFIRMED' });

      await expect(
        service.confirmOrder(ORDER_ID, TENANT_ID, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── cancelOrder ────────────────────────────────────────────────────────────

  describe('cancelOrder', () => {
    it('cancels a DRAFT order and emits order.cancelled', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(mockOrder);
      mockPrisma.order.update.mockResolvedValue({ ...mockOrder, status: 'CANCELLED' });

      await service.cancelOrder(ORDER_ID, TENANT_ID, USER_ID);

      expect(mockKafka.emit).toHaveBeenCalledWith(
        'order.cancelled',
        expect.objectContaining({ key: TENANT_ID }),
      );
      expect(mockKafka.emit).toHaveBeenCalledWith(
        'order.status-changed',
        expect.objectContaining({
          value: expect.objectContaining({ toStatus: 'CANCELLED' }),
        }),
      );
    });

    it('throws BadRequestException when already CANCELLED', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({ ...mockOrder, status: 'CANCELLED' });

      await expect(
        service.cancelOrder(ORDER_ID, TENANT_ID, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when DISPATCHED', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({ ...mockOrder, status: 'DISPATCHED' });

      await expect(
        service.cancelOrder(ORDER_ID, TENANT_ID, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── dispatchOrder ──────────────────────────────────────────────────────────

  describe('dispatchOrder', () => {
    it('dispatches a QC_PASSED order and emits status-changed', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({ ...mockOrder, status: 'QC_PASSED' });
      mockPrisma.order.update.mockResolvedValue({ ...mockOrder, status: 'DISPATCHED' });

      await service.dispatchOrder(ORDER_ID, TENANT_ID, USER_ID);

      expect(mockKafka.emit).toHaveBeenCalledWith(
        'order.status-changed',
        expect.objectContaining({
          value: expect.objectContaining({ fromStatus: 'QC_PASSED', toStatus: 'DISPATCHED' }),
        }),
      );
    });

    it('throws BadRequestException when not QC_PASSED', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({ ...mockOrder, status: 'CONFIRMED' });

      await expect(
        service.dispatchOrder(ORDER_ID, TENANT_ID, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
