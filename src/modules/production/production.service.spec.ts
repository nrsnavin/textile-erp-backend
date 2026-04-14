import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ProductionService }    from './production.service';
import { ProductionRepository } from './production.repository';
import { AuditService }         from '../../shared/services/audit.service';
import { KafkaService }         from '../../shared/services/kafka.service';
import { CutOrderStatus, LinePlanStatus, WipStage } from './dto/production.dto';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockRepo = () => ({
  createCutOrder:       jest.fn(),
  findCutOrderById:     jest.fn(),
  listCutOrders:        jest.fn(),
  updateCutOrder:       jest.fn(),
  nextCutOrderNumber:   jest.fn(),
  createLinePlan:       jest.fn(),
  findLinePlanById:     jest.fn(),
  listLinePlans:        jest.fn(),
  updateLinePlan:       jest.fn(),
  createWipRecord:      jest.fn(),
  findWipRecordById:    jest.fn(),
  listWipRecords:       jest.fn(),
  updateWipRecord:      jest.fn(),
  getDashboardStats:    jest.fn(),
});

const mockAudit = () => ({
  log:        jest.fn(),
  getHistory: jest.fn(),
});

const mockKafka = () => ({
  emit:       jest.fn(),
  subscribe:  jest.fn(),
  isAvailable: jest.fn().mockReturnValue(true),
});

describe('ProductionService', () => {
  let service: ProductionService;
  let repo:    ReturnType<typeof mockRepo>;
  let audit:   ReturnType<typeof mockAudit>;
  let kafka:   ReturnType<typeof mockKafka>;

  const tenantId = 'tenant-001';
  const userId   = 'user-001';

  beforeEach(() => {
    repo   = mockRepo();
    audit  = mockAudit();
    kafka  = mockKafka();
    service = new ProductionService(
      repo as any as ProductionRepository,
      audit as any as AuditService,
      kafka as any as KafkaService,
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CUT ORDERS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('createCutOrder', () => {
    const dto = {
      orderId:    'order-001',
      styleCode:  'ST-100',
      plannedQty: 500,
      plannedDate: '2026-05-01',
    };

    it('creates a cut order with auto-generated number', async () => {
      repo.nextCutOrderNumber.mockResolvedValue(1);
      repo.createCutOrder.mockResolvedValue({
        id: 'co-001', cutOrderNumber: 'CUT-2026-0001', ...dto, status: 'PLANNED',
      });

      const result = await service.createCutOrder(dto, tenantId, userId);

      expect(repo.createCutOrder).toHaveBeenCalledWith(
        dto,
        expect.stringMatching(/^CUT-\d{4}-0001$/),
        tenantId,
        userId,
      );
      expect(result.cutOrderNumber).toMatch(/^CUT-\d{4}-0001$/);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'CREATE', tableName: 'cut_orders',
      }));
      expect(kafka.emit).toHaveBeenCalled();
    });
  });

  describe('getCutOrder', () => {
    it('returns cut order when found', async () => {
      repo.findCutOrderById.mockResolvedValue({ id: 'co-001', status: 'PLANNED' });
      const result = await service.getCutOrder('co-001', tenantId);
      expect(result.id).toBe('co-001');
    });

    it('throws 404 when not found', async () => {
      repo.findCutOrderById.mockResolvedValue(null);
      await expect(service.getCutOrder('missing', tenantId))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('updateCutOrder — status transitions', () => {
    it('allows PLANNED → CUTTING', async () => {
      repo.findCutOrderById.mockResolvedValue({ id: 'co-001', status: 'PLANNED', cutQty: 0 });
      repo.updateCutOrder.mockResolvedValue({ id: 'co-001', status: 'CUTTING', cutQty: 0 });

      const result = await service.updateCutOrder(
        'co-001', { status: CutOrderStatus.CUTTING }, tenantId, userId,
      );
      expect(result.status).toBe('CUTTING');
    });

    it('allows CUTTING → COMPLETED', async () => {
      repo.findCutOrderById.mockResolvedValue({ id: 'co-001', status: 'CUTTING', cutQty: 100 });
      repo.updateCutOrder.mockResolvedValue({ id: 'co-001', status: 'COMPLETED', cutQty: 100 });

      const result = await service.updateCutOrder(
        'co-001', { status: CutOrderStatus.COMPLETED }, tenantId, userId,
      );
      expect(result.status).toBe('COMPLETED');
    });

    it('rejects PLANNED → COMPLETED (must go through CUTTING)', async () => {
      repo.findCutOrderById.mockResolvedValue({ id: 'co-001', status: 'PLANNED', cutQty: 0 });

      await expect(
        service.updateCutOrder('co-001', { status: CutOrderStatus.COMPLETED }, tenantId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects updates on COMPLETED cut orders', async () => {
      repo.findCutOrderById.mockResolvedValue({ id: 'co-001', status: 'COMPLETED', cutQty: 500 });

      await expect(
        service.updateCutOrder('co-001', { cutQty: 600 }, tenantId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects updates on CANCELLED cut orders', async () => {
      repo.findCutOrderById.mockResolvedValue({ id: 'co-001', status: 'CANCELLED', cutQty: 0 });

      await expect(
        service.updateCutOrder('co-001', { cutQty: 100 }, tenantId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 404 for missing cut order', async () => {
      repo.findCutOrderById.mockResolvedValue(null);

      await expect(
        service.updateCutOrder('missing', { cutQty: 100 }, tenantId, userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LINE PLANS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('createLinePlan', () => {
    const dto = {
      orderId:    'order-001',
      lineNumber: 'LINE-01',
      styleCode:  'ST-100',
      targetQty:  200,
      planDate:   '2026-05-01',
    };

    it('creates a line plan and logs audit', async () => {
      repo.createLinePlan.mockResolvedValue({ id: 'lp-001', ...dto, status: 'SCHEDULED' });

      const result = await service.createLinePlan(dto, tenantId, userId);

      expect(result.id).toBe('lp-001');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'CREATE', tableName: 'line_plans',
      }));
    });
  });

  describe('updateLinePlan — status transitions', () => {
    it('allows SCHEDULED → RUNNING', async () => {
      repo.findLinePlanById.mockResolvedValue({
        id: 'lp-001', status: 'SCHEDULED', achievedQty: 0, sam: null, operatorCount: 0,
      });
      repo.updateLinePlan.mockResolvedValue({ id: 'lp-001', status: 'RUNNING', achievedQty: 0 });

      const result = await service.updateLinePlan(
        'lp-001', { status: LinePlanStatus.RUNNING }, tenantId, userId,
      );
      expect(result.status).toBe('RUNNING');
    });

    it('rejects SCHEDULED → COMPLETED (must go through RUNNING)', async () => {
      repo.findLinePlanById.mockResolvedValue({
        id: 'lp-001', status: 'SCHEDULED', achievedQty: 0, sam: null, operatorCount: 0,
      });

      await expect(
        service.updateLinePlan('lp-001', { status: LinePlanStatus.COMPLETED }, tenantId, userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('auto-calculates efficiency when SAM and operators exist', async () => {
      repo.findLinePlanById.mockResolvedValue({
        id: 'lp-001', status: 'RUNNING', achievedQty: 0,
        sam: 10, operatorCount: 20,
      });
      repo.updateLinePlan.mockImplementation((id, tid, data) => Promise.resolve({
        id, status: 'RUNNING', ...data,
      }));

      await service.updateLinePlan(
        'lp-001', { achievedQty: 800 }, tenantId, userId,
      );

      // efficiency = (800 * 10) / (20 * 480) * 100 = 8000 / 9600 * 100 = 83.33%
      expect(repo.updateLinePlan).toHaveBeenCalledWith(
        'lp-001', tenantId,
        expect.objectContaining({ efficiency: 83.33 }),
      );
    });

    it('throws 404 for missing line plan', async () => {
      repo.findLinePlanById.mockResolvedValue(null);
      await expect(
        service.updateLinePlan('missing', { achievedQty: 10 }, tenantId, userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // WIP RECORDS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('createWipRecord', () => {
    it('creates a WIP record', async () => {
      const dto = {
        orderId:    'order-001',
        styleCode:  'ST-100',
        stage:      WipStage.SEWING,
        inputQty:   500,
        outputQty:  480,
        rejectQty:  5,
        recordDate: '2026-05-01',
      };
      repo.createWipRecord.mockResolvedValue({ id: 'wip-001', ...dto });

      const result = await service.createWipRecord(dto, tenantId, userId);

      expect(result.id).toBe('wip-001');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'CREATE', tableName: 'wip_records',
      }));
    });

    it('rejects when output + reject exceeds input', async () => {
      const dto = {
        orderId:    'order-001',
        styleCode:  'ST-100',
        stage:      WipStage.CUTTING,
        inputQty:   100,
        outputQty:  80,
        rejectQty:  30,     // 80 + 30 = 110 > 100
        recordDate: '2026-05-01',
      };

      await expect(service.createWipRecord(dto, tenantId, userId))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('updateWipRecord', () => {
    it('updates output and reject quantities', async () => {
      repo.findWipRecordById.mockResolvedValue({
        id: 'wip-001', inputQty: 500, outputQty: 400, rejectQty: 10,
      });
      repo.updateWipRecord.mockResolvedValue({
        id: 'wip-001', inputQty: 500, outputQty: 480, rejectQty: 15,
      });

      const result = await service.updateWipRecord(
        'wip-001', { outputQty: 480, rejectQty: 15 }, tenantId, userId,
      );
      expect(result.outputQty).toBe(480);
    });

    it('rejects when updated output + reject exceeds input', async () => {
      repo.findWipRecordById.mockResolvedValue({
        id: 'wip-001', inputQty: 100, outputQty: 80, rejectQty: 10,
      });

      await expect(
        service.updateWipRecord('wip-001', { outputQty: 95 }, tenantId, userId),
        // 95 + 10 = 105 > 100
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 404 for missing WIP record', async () => {
      repo.findWipRecordById.mockResolvedValue(null);
      await expect(
        service.updateWipRecord('missing', { outputQty: 10 }, tenantId, userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getDashboardStats', () => {
    it('returns production dashboard stats', async () => {
      repo.getDashboardStats.mockResolvedValue({
        activeCutOrders: 5,
        runningLines:    3,
        wipByStage:      [],
        todayCutQty:     1200,
        todayAchievedQty: 950,
      });

      const result = await service.getDashboardStats(tenantId);
      expect(result.activeCutOrders).toBe(5);
      expect(result.runningLines).toBe(3);
    });
  });
});
