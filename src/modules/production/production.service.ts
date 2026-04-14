// src/modules/production/production.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ProductionRepository } from './production.repository';
import { AuditService }         from '../../shared/services/audit.service';
import { KafkaService }         from '../../shared/services/kafka.service';
import {
  CreateCutOrderDto, UpdateCutOrderDto, CutOrderFilterDto, CutOrderStatus,
  CreateLinePlanDto, UpdateLinePlanDto, LinePlanFilterDto, LinePlanStatus,
  CreateWipRecordDto, UpdateWipRecordDto, WipFilterDto,
} from './dto/production.dto';

@Injectable()
export class ProductionService {
  constructor(
    private readonly repo:  ProductionRepository,
    private readonly audit: AuditService,
    private readonly kafka: KafkaService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // CUT ORDERS
  // ═══════════════════════════════════════════════════════════════════════════

  async createCutOrder(dto: CreateCutOrderDto, tenantId: string, userId: string) {
    const seq  = await this.repo.nextCutOrderNumber(tenantId);
    const year = new Date().getFullYear();
    const cutOrderNumber = `CUT-${year}-${String(seq).padStart(4, '0')}`;

    const cutOrder = await this.repo.createCutOrder(dto, cutOrderNumber, tenantId, userId);

    await this.audit.log({
      tenantId, userId,
      action: 'CREATE', tableName: 'cut_orders', recordId: cutOrder.id,
      newValues: { cutOrderNumber, orderId: dto.orderId, plannedQty: dto.plannedQty },
    });

    await this.kafka.emit('production.cut-order-created', {
      key: tenantId,
      value: { tenantId, cutOrderId: cutOrder.id, cutOrderNumber, orderId: dto.orderId },
    });

    return cutOrder;
  }

  async getCutOrder(id: string, tenantId: string) {
    const co = await this.repo.findCutOrderById(id, tenantId);
    if (!co) throw new NotFoundException(`Cut order ${id} not found`);
    return co;
  }

  async listCutOrders(filters: CutOrderFilterDto, tenantId: string) {
    return this.repo.listCutOrders(filters, tenantId);
  }

  async updateCutOrder(id: string, dto: UpdateCutOrderDto, tenantId: string, userId: string) {
    const existing = await this.repo.findCutOrderById(id, tenantId);
    if (!existing) throw new NotFoundException(`Cut order ${id} not found`);

    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      throw new BadRequestException(`Cannot update a ${existing.status} cut order`);
    }

    // Validate status transitions
    if (dto.status) {
      this.validateCutOrderTransition(existing.status, dto.status);
    }

    const data: Record<string, any> = {};
    if (dto.cutQty !== undefined)          data.cutQty          = dto.cutQty;
    if (dto.damagedQty !== undefined)      data.damagedQty      = dto.damagedQty;
    if (dto.fabricConsumption !== undefined) data.fabricConsumption = dto.fabricConsumption;
    if (dto.status) {
      data.status = dto.status;
      if (dto.status === CutOrderStatus.COMPLETED) data.completedAt = new Date();
    }

    const updated = await this.repo.updateCutOrder(id, tenantId, data);

    await this.audit.log({
      tenantId, userId,
      action: 'UPDATE', tableName: 'cut_orders', recordId: id,
      oldValues: { status: existing.status, cutQty: existing.cutQty },
      newValues: { status: updated.status, cutQty: updated.cutQty },
    });

    return updated;
  }

  private validateCutOrderTransition(current: string, next: string) {
    const transitions: Record<string, string[]> = {
      PLANNED:   ['CUTTING', 'CANCELLED'],
      CUTTING:   ['COMPLETED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
    };
    const allowed = transitions[current] ?? [];
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `Invalid cut order transition: ${current} → ${next}. Allowed: ${allowed.join(', ') || 'none'}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LINE PLANS
  // ═══════════════════════════════════════════════════════════════════════════

  async createLinePlan(dto: CreateLinePlanDto, tenantId: string, userId: string) {
    const linePlan = await this.repo.createLinePlan(dto, tenantId, userId);

    await this.audit.log({
      tenantId, userId,
      action: 'CREATE', tableName: 'line_plans', recordId: linePlan.id,
      newValues: { lineNumber: dto.lineNumber, orderId: dto.orderId, targetQty: dto.targetQty },
    });

    return linePlan;
  }

  async getLinePlan(id: string, tenantId: string) {
    const lp = await this.repo.findLinePlanById(id, tenantId);
    if (!lp) throw new NotFoundException(`Line plan ${id} not found`);
    return lp;
  }

  async listLinePlans(filters: LinePlanFilterDto, tenantId: string) {
    return this.repo.listLinePlans(filters, tenantId);
  }

  async updateLinePlan(id: string, dto: UpdateLinePlanDto, tenantId: string, userId: string) {
    const existing = await this.repo.findLinePlanById(id, tenantId);
    if (!existing) throw new NotFoundException(`Line plan ${id} not found`);

    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      throw new BadRequestException(`Cannot update a ${existing.status} line plan`);
    }

    if (dto.status) {
      this.validateLinePlanTransition(existing.status, dto.status);
    }

    const data: Record<string, any> = {};
    if (dto.achievedQty !== undefined) data.achievedQty = dto.achievedQty;
    if (dto.rejectQty !== undefined)   data.rejectQty   = dto.rejectQty;
    if (dto.efficiency !== undefined)  data.efficiency   = dto.efficiency;
    if (dto.status)                    data.status       = dto.status;

    // Auto-compute efficiency if achievedQty updated and SAM exists
    if (dto.achievedQty !== undefined && existing.sam && existing.operatorCount > 0) {
      const minutesAvailable = existing.operatorCount * 480; // 8-hour shift
      const minutesProduced  = dto.achievedQty * existing.sam;
      data.efficiency = Math.round((minutesProduced / minutesAvailable) * 10000) / 100;
    }

    const updated = await this.repo.updateLinePlan(id, tenantId, data);

    await this.audit.log({
      tenantId, userId,
      action: 'UPDATE', tableName: 'line_plans', recordId: id,
      oldValues: { status: existing.status, achievedQty: existing.achievedQty },
      newValues: { status: updated.status, achievedQty: updated.achievedQty },
    });

    return updated;
  }

  private validateLinePlanTransition(current: string, next: string) {
    const transitions: Record<string, string[]> = {
      SCHEDULED: ['RUNNING', 'CANCELLED'],
      RUNNING:   ['COMPLETED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
    };
    const allowed = transitions[current] ?? [];
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `Invalid line plan transition: ${current} → ${next}. Allowed: ${allowed.join(', ') || 'none'}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WIP RECORDS
  // ═══════════════════════════════════════════════════════════════════════════

  async createWipRecord(dto: CreateWipRecordDto, tenantId: string, userId: string) {
    // Validate: outputQty + rejectQty should not exceed inputQty
    const output = (dto.outputQty ?? 0) + (dto.rejectQty ?? 0);
    if (output > dto.inputQty) {
      throw new BadRequestException(
        `Output (${dto.outputQty ?? 0}) + Reject (${dto.rejectQty ?? 0}) cannot exceed input (${dto.inputQty})`,
      );
    }

    const wip = await this.repo.createWipRecord(dto, tenantId, userId);

    await this.audit.log({
      tenantId, userId,
      action: 'CREATE', tableName: 'wip_records', recordId: wip.id,
      newValues: { stage: dto.stage, orderId: dto.orderId, inputQty: dto.inputQty },
    });

    return wip;
  }

  async getWipRecord(id: string, tenantId: string) {
    const wip = await this.repo.findWipRecordById(id, tenantId);
    if (!wip) throw new NotFoundException(`WIP record ${id} not found`);
    return wip;
  }

  async listWipRecords(filters: WipFilterDto, tenantId: string) {
    return this.repo.listWipRecords(filters, tenantId);
  }

  async updateWipRecord(id: string, dto: UpdateWipRecordDto, tenantId: string, userId: string) {
    const existing = await this.repo.findWipRecordById(id, tenantId);
    if (!existing) throw new NotFoundException(`WIP record ${id} not found`);

    const newOutput = dto.outputQty ?? existing.outputQty;
    const newReject = dto.rejectQty ?? existing.rejectQty;
    if (newOutput + newReject > existing.inputQty) {
      throw new BadRequestException(
        `Output (${newOutput}) + Reject (${newReject}) cannot exceed input (${existing.inputQty})`,
      );
    }

    const data: Record<string, any> = {};
    if (dto.outputQty !== undefined) data.outputQty = dto.outputQty;
    if (dto.rejectQty !== undefined) data.rejectQty = dto.rejectQty;
    if (dto.remarks !== undefined)   data.remarks   = dto.remarks;

    const updated = await this.repo.updateWipRecord(id, tenantId, data);

    await this.audit.log({
      tenantId, userId,
      action: 'UPDATE', tableName: 'wip_records', recordId: id,
      oldValues: { outputQty: existing.outputQty, rejectQty: existing.rejectQty },
      newValues: { outputQty: updated.outputQty, rejectQty: updated.rejectQty },
    });

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  async getDashboardStats(tenantId: string) {
    return this.repo.getDashboardStats(tenantId);
  }
}
