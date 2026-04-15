// src/modules/quality/quality.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { QualityRepository } from './quality.repository';
import { AuditService }      from '../../shared/services/audit.service';
import { KafkaService }      from '../../shared/services/kafka.service';
import {
  CreateQcInspectionDto,
  UpdateQcInspectionDto,
  QcFilterDto,
} from './dto/quality.dto';

@Injectable()
export class QualityService {
  constructor(
    private readonly repo:  QualityRepository,
    private readonly audit: AuditService,
    private readonly kafka: KafkaService,
  ) {}

  // ── Create inspection ─────────────────────────────────────────────────────

  async createInspection(dto: CreateQcInspectionDto, tenantId: string, userId: string) {
    const inspection = await this.repo.create(dto, tenantId, userId);

    await this.audit.log({
      tenantId, userId,
      action:    'CREATE',
      tableName: 'qc_inspections',
      recordId:  inspection.id,
      newValues: { orderId: dto.orderId, inspType: dto.inspType, result: dto.result },
    });

    this.kafka.emit('quality.inspection-completed', {
      key:   tenantId,
      value: {
        tenantId,
        inspectionId: inspection.id,
        orderId:      dto.orderId,
        styleCode:    dto.styleCode,
        inspType:     dto.inspType,
        result:       dto.result,
        defectCount:  dto.defectCount,
        timestamp:    new Date().toISOString(),
      },
    });

    return inspection;
  }

  // ── Get single inspection ─────────────────────────────────────────────────

  async getInspection(id: string, tenantId: string) {
    const inspection = await this.repo.findById(id, tenantId);
    if (!inspection) throw new NotFoundException(`QC inspection ${id} not found`);
    return inspection;
  }

  // ── List with filters ─────────────────────────────────────────────────────

  async listInspections(filters: QcFilterDto, tenantId: string) {
    return this.repo.findMany(filters, tenantId);
  }

  // ── Update inspection ─────────────────────────────────────────────────────

  async updateInspection(
    id: string,
    dto: UpdateQcInspectionDto,
    tenantId: string,
    userId: string,
  ) {
    const existing = await this.repo.findById(id, tenantId);
    if (!existing) throw new NotFoundException(`QC inspection ${id} not found`);

    const updateData: Record<string, any> = {};
    if (dto.result       !== undefined) updateData.result       = dto.result;
    if (dto.defectCount  !== undefined) updateData.defectCount  = dto.defectCount;
    if (dto.photoUrls    !== undefined) updateData.photoUrls    = dto.photoUrls;
    if (dto.notes        !== undefined) updateData.notes        = dto.notes;

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('No fields to update');
    }

    const updated = await this.repo.update(id, tenantId, updateData);

    await this.audit.log({
      tenantId, userId,
      action:    'UPDATE',
      tableName: 'qc_inspections',
      recordId:  id,
      oldValues: { result: existing.result, defectCount: existing.defectCount },
      newValues: updateData,
    });

    return updated;
  }

  // ── Dashboard stats ───────────────────────────────────────────────────────

  async getDashboardStats(tenantId: string) {
    return this.repo.getDashboardStats(tenantId);
  }

  // ── Inspections for an order ──────────────────────────────────────────────

  async getInspectionsByOrder(orderId: string, tenantId: string) {
    return this.repo.findByOrderId(orderId, tenantId);
  }
}
