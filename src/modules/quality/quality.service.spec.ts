// src/modules/quality/quality.service.spec.ts

import { Test, TestingModule }           from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { QualityService }                from './quality.service';
import { QualityRepository }             from './quality.repository';
import { AuditService }                  from '../../shared/services/audit.service';
import { KafkaService }                  from '../../shared/services/kafka.service';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT  = 'tenant-1';
const USER    = 'user-1';
const ORDER   = 'order-1';
const INSP_ID = 'insp-1';

const mockInspection = {
  id:          INSP_ID,
  tenantId:    TENANT,
  orderId:     ORDER,
  styleCode:   'SS24-TEE-001',
  inspectorId: USER,
  inspType:    'INLINE',
  result:      'PASS',
  aqlLevel:    '2.5',
  sampleSize:  50,
  defectCount: 2,
  photoUrls:   [],
  notes:       null,
  createdAt:   new Date(),
  order:       { id: ORDER, poNumber: 'PO-001', status: 'IN_PRODUCTION' },
};

const mockStats = {
  totalInspections: 10,
  passCount:        7,
  failCount:        2,
  conditionalCount: 1,
  passRate:         70,
  avgDefects:       3.5,
};

// ── Mocks ────────────────────────────────────────────────────────────────────

function mockRepo() {
  return {
    create:            jest.fn().mockResolvedValue(mockInspection),
    findById:          jest.fn().mockResolvedValue(mockInspection),
    findMany:          jest.fn().mockResolvedValue({ data: [mockInspection], meta: { total: 1 } }),
    update:            jest.fn().mockResolvedValue({ ...mockInspection, result: 'FAIL' }),
    getDashboardStats: jest.fn().mockResolvedValue(mockStats),
    findByOrderId:     jest.fn().mockResolvedValue([mockInspection]),
  };
}

function mockAudit() { return { log: jest.fn().mockResolvedValue(undefined) }; }
function mockKafka() { return { emit: jest.fn().mockResolvedValue(undefined) }; }

// ── Suite ────────────────────────────────────────────────────────────────────

describe('QualityService', () => {
  let service: QualityService;
  let repo:    ReturnType<typeof mockRepo>;
  let audit:   ReturnType<typeof mockAudit>;
  let kafka:   ReturnType<typeof mockKafka>;

  beforeEach(async () => {
    repo  = mockRepo();
    audit = mockAudit();
    kafka = mockKafka();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QualityService,
        { provide: QualityRepository, useValue: repo },
        { provide: AuditService,      useValue: audit },
        { provide: KafkaService,      useValue: kafka },
      ],
    }).compile();

    service = module.get<QualityService>(QualityService);
  });

  // ── createInspection ──────────────────────────────────────────────────────

  describe('createInspection', () => {
    it('creates inspection, logs audit, emits Kafka event', async () => {
      const dto = {
        orderId:     ORDER,
        styleCode:   'SS24-TEE-001',
        inspType:    'INLINE',
        result:      'PASS',
        defectCount: 2,
      };

      const result = await service.createInspection(dto as any, TENANT, USER);

      expect(repo.create).toHaveBeenCalledWith(dto, TENANT, USER);
      expect(result.id).toBe(INSP_ID);

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', tableName: 'qc_inspections' }),
      );

      expect(kafka.emit).toHaveBeenCalledWith(
        'quality.inspection-completed',
        expect.objectContaining({
          key: TENANT,
          value: expect.objectContaining({ orderId: ORDER, result: 'PASS' }),
        }),
      );
    });
  });

  // ── getInspection ─────────────────────────────────────────────────────────

  describe('getInspection', () => {
    it('returns inspection when found', async () => {
      const result = await service.getInspection(INSP_ID, TENANT);
      expect(result.id).toBe(INSP_ID);
    });

    it('throws 404 when not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.getInspection('bad-id', TENANT)).rejects.toThrow(NotFoundException);
    });
  });

  // ── listInspections ───────────────────────────────────────────────────────

  describe('listInspections', () => {
    it('delegates to repo with filters', async () => {
      const filters = { orderId: ORDER, page: 1, limit: 20, skip: 0 };
      await service.listInspections(filters as any, TENANT);
      expect(repo.findMany).toHaveBeenCalledWith(filters, TENANT);
    });
  });

  // ── updateInspection ──────────────────────────────────────────────────────

  describe('updateInspection', () => {
    it('updates result and logs audit', async () => {
      const dto = { result: 'FAIL', defectCount: 5 };
      const result = await service.updateInspection(INSP_ID, dto, TENANT, USER);

      expect(repo.update).toHaveBeenCalledWith(INSP_ID, TENANT, { result: 'FAIL', defectCount: 5 });
      expect(result.result).toBe('FAIL');

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action:    'UPDATE',
          oldValues: expect.objectContaining({ result: 'PASS' }),
          newValues: expect.objectContaining({ result: 'FAIL' }),
        }),
      );
    });

    it('throws 404 when inspection not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        service.updateInspection('bad-id', { result: 'FAIL' }, TENANT, USER),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when no fields to update', async () => {
      await expect(
        service.updateInspection(INSP_ID, {}, TENANT, USER),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── getDashboardStats ─────────────────────────────────────────────────────

  describe('getDashboardStats', () => {
    it('returns QC dashboard stats', async () => {
      const result = await service.getDashboardStats(TENANT);
      expect(result.passRate).toBe(70);
      expect(result.totalInspections).toBe(10);
    });
  });

  // ── getInspectionsByOrder ─────────────────────────────────────────────────

  describe('getInspectionsByOrder', () => {
    it('returns inspections for an order', async () => {
      const result = await service.getInspectionsByOrder(ORDER, TENANT);
      expect(result).toHaveLength(1);
      expect(repo.findByOrderId).toHaveBeenCalledWith(ORDER, TENANT);
    });
  });
});
