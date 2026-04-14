// src/modules/mrp/mrp.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { MrpRepository }  from './mrp.repository';
import { MrpEngine }      from './mrp-engine';
import { AuditService }   from '../../shared/services/audit.service';
import {
  CreateBomDto, UpdateBomDto, RunMrpDto,
  MrpRunFilterDto, PrFilterDto, ApprovePrDto, UpsertStockDto,
} from './dto/mrp.dto';

@Injectable()
export class MrpService {
  private readonly engine = new MrpEngine();

  constructor(
    private readonly repo:  MrpRepository,
    private readonly audit: AuditService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // BOM MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  async createBom(dto: CreateBomDto, tenantId: string, userId: string) {
    if (dto.lines.length === 0) {
      throw new BadRequestException('BOM must have at least one component line');
    }

    const bom = await this.repo.createBom(dto, tenantId, userId);

    await this.audit.log({
      tenantId, userId,
      action: 'CREATE', tableName: 'boms', recordId: bom.id,
      newValues: { parentItemId: dto.parentItemId, lineCount: dto.lines.length },
    });

    return bom;
  }

  async getBom(id: string, tenantId: string) {
    const bom = await this.repo.findBomById(id, tenantId);
    if (!bom) throw new NotFoundException(`BOM ${id} not found`);
    return bom;
  }

  async listBoms(tenantId: string) {
    return this.repo.listBoms(tenantId);
  }

  async updateBom(id: string, dto: UpdateBomDto, tenantId: string, userId: string) {
    const existing = await this.repo.findBomById(id, tenantId);
    if (!existing) throw new NotFoundException(`BOM ${id} not found`);

    const updated = await this.repo.updateBom(id, tenantId, dto);

    await this.audit.log({
      tenantId, userId,
      action: 'UPDATE', tableName: 'boms', recordId: id,
      oldValues: { lineCount: existing.lines?.length },
      newValues: { lineCount: updated.lines?.length, isActive: updated.isActive },
    });

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MRP RUN
  // ═══════════════════════════════════════════════════════════════════════════

  async runMrp(dto: RunMrpDto, tenantId: string, userId: string) {
    // Create run record
    const run = await this.repo.createMrpRun(tenantId, userId);

    try {
      // Load data
      const [bomMap, demands, stockMap] = await Promise.all([
        this.repo.loadBomMap(tenantId),
        this.repo.loadOrderDemands(tenantId, dto.orderIds),
        this.repo.loadStockMap(tenantId),
      ]);

      if (demands.length === 0) {
        await this.repo.completeMrpRun(run.id, {
          status: 'COMPLETED',
          orderCount: 0, lineCount: 0, requisitionCount: 0, durationMs: 0,
        });
        return { runId: run.id, message: 'No demands to plan', ...await this.repo.findMrpRunById(run.id, tenantId) };
      }

      // Execute MRP engine
      const result = this.engine.calculate(
        demands,
        bomMap,
        stockMap,
        dto.maxDepth ?? 10,
      );

      // Persist MRP lines
      const mrpLines = result.lines.map(l => ({
        tenantId,
        mrpRunId:         run.id,
        itemId:           l.itemId,
        itemCode:         l.itemCode,
        itemName:         l.itemName,
        unit:             l.unit,
        grossRequirement: l.grossRequirement,
        onHand:           l.onHand,
        onOrder:          l.onOrder,
        allocated:        l.allocated,
        netRequirement:   l.netRequirement,
        requiredByDate:   l.requiredByDate,
        orderByDate:      l.orderByDate,
      }));
      await this.repo.saveMrpLines(mrpLines);

      // Generate PR numbers and persist requisitions
      let prSeq = await this.repo.nextPrNumber(tenantId);
      const year = new Date().getFullYear();
      const prs = result.requisitions.map(r => {
        const prNumber = `PR-${year}-${String(prSeq++).padStart(4, '0')}`;
        return {
          tenantId,
          mrpRunId:       run.id,
          prNumber,
          itemId:         r.itemId,
          itemCode:       r.itemCode,
          itemName:       r.itemName,
          qty:            r.netRequirement,
          unit:           r.unit,
          requiredByDate: r.requiredByDate,
          orderByDate:    r.orderByDate,
          status:         'OPEN',
        };
      });
      await this.repo.savePurchaseRequisitions(prs);

      // Complete run
      await this.repo.completeMrpRun(run.id, {
        status:           'COMPLETED',
        orderCount:       result.orderCount,
        lineCount:        result.lineCount,
        requisitionCount: result.requisitions.length,
        durationMs:       result.durationMs,
      });

      await this.audit.log({
        tenantId, userId,
        action: 'CREATE', tableName: 'mrp_runs', recordId: run.id,
        newValues: {
          orderCount:       result.orderCount,
          lineCount:        result.lineCount,
          requisitionCount: result.requisitions.length,
          durationMs:       result.durationMs,
        },
      });

      return this.repo.findMrpRunById(run.id, tenantId);

    } catch (error: any) {
      await this.repo.completeMrpRun(run.id, {
        status: 'FAILED',
        error:  error?.message ?? 'Unknown error',
      });
      throw error;
    }
  }

  async getMrpRun(id: string, tenantId: string) {
    const run = await this.repo.findMrpRunById(id, tenantId);
    if (!run) throw new NotFoundException(`MRP run ${id} not found`);
    return run;
  }

  async listMrpRuns(filters: MrpRunFilterDto, tenantId: string) {
    return this.repo.listMrpRuns(filters, tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PURCHASE REQUISITIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async listPurchaseRequisitions(filters: PrFilterDto, tenantId: string) {
    return this.repo.listPurchaseRequisitions(filters, tenantId);
  }

  async approvePrs(dto: ApprovePrDto, tenantId: string, userId: string) {
    const result = await this.repo.approvePrs(dto.prIds, tenantId);

    await this.audit.log({
      tenantId, userId,
      action: 'UPDATE', tableName: 'purchase_requisitions', recordId: dto.prIds.join(','),
      newValues: { status: 'APPROVED', count: result.count },
    });

    return { approved: result.count };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STOCK
  // ═══════════════════════════════════════════════════════════════════════════

  async upsertStock(dto: UpsertStockDto, tenantId: string) {
    return this.repo.upsertStock(dto, tenantId);
  }

  async listStock(tenantId: string) {
    return this.repo.listStock(tenantId);
  }
}
