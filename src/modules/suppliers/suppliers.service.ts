import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SuppliersRepository } from './suppliers.repository';
import { AuditService }        from '../../shared/services/audit.service';
import { KafkaService }        from '../../shared/services/kafka.service';
import { randomUUID }          from 'crypto';
import {
  CreateSupplierDto, UpdateSupplierDto, SupplierFilterDto,
  CreatePurchaseOrderDto, PoFilterDto,
} from './dto/supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly repo:  SuppliersRepository,
    private readonly audit: AuditService,
    private readonly kafka: KafkaService,
  ) {}

  async listSuppliers(filters: SupplierFilterDto, tenantId: string) {
    return this.repo.findSuppliersWithFilters(filters, tenantId);
  }

  async getSupplier(id: string, tenantId: string) {
    const supplier = await this.repo.findSupplierById(id, tenantId);
    if (!supplier) throw new NotFoundException(`Supplier ${id} not found`);
    return supplier;
  }

  async createSupplier(dto: CreateSupplierDto, tenantId: string, userId: string) {
    const supplier = await this.repo.createSupplier(dto, tenantId);
    await this.audit.log({
      tenantId, userId,
      action: 'CREATE', tableName: 'suppliers', recordId: supplier.id,
      newValues: { name: supplier.name },
    });
    return supplier;
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto, tenantId: string, userId: string) {
    const existing = await this.repo.findSupplierById(id, tenantId);
    if (!existing) throw new NotFoundException(`Supplier ${id} not found`);
    const updated = await this.repo.updateSupplier(id, dto);
    await this.audit.log({
      tenantId, userId,
      action: 'UPDATE', tableName: 'suppliers', recordId: id,
      oldValues: { name: existing.name },
      newValues: { name: updated.name },
    });
    return updated;
  }

  async listPurchaseOrders(filters: PoFilterDto, tenantId: string) {
    return this.repo.findPosWithFilters(filters, tenantId);
  }

  async getPurchaseOrder(id: string, tenantId: string) {
    const po = await this.repo.findPoById(id, tenantId);
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    return po;
  }

  async createPurchaseOrder(dto: CreatePurchaseOrderDto, tenantId: string, userId: string) {
    const supplier = await this.repo.findSupplierById(dto.supplierId, tenantId);
    if (!supplier) throw new NotFoundException(`Supplier ${dto.supplierId} not found`);

    if (new Date(dto.expectedDate) <= new Date()) {
      throw new BadRequestException('Expected date must be in the future');
    }

    const count    = await this.repo.getPoCount(tenantId);
    const poNumber = `PO-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;
    const po       = await this.repo.createPo(dto, tenantId, userId, poNumber);

    await this.audit.log({
      tenantId, userId,
      action: 'CREATE', tableName: 'purchase_orders', recordId: po.id,
      newValues: { poNumber, supplierId: dto.supplierId },
    });

    return po;
  }

  async sendPurchaseOrder(id: string, tenantId: string, userId: string) {
    const po = await this.repo.findPoById(id, tenantId);
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    if (po.status !== 'DRAFT') {
      throw new BadRequestException(`PO is already ${po.status}`);
    }

    const updated = await this.repo.updatePoStatus(id, 'SENT', { sentAt: new Date() });

    await this.kafka.emit('supplier.po-dispatched', {
      key:   tenantId,
      value: {
        eventId:   randomUUID(),
        eventType: 'PoDispatched',
        tenantId,
        poId:      id,
        supplierId: po.supplierId,
        poNumber:  po.poNumber,
        timestamp: new Date().toISOString(),
      },
    });

    await this.audit.log({
      tenantId, userId,
      action: 'SEND_PO', tableName: 'purchase_orders', recordId: id,
      oldValues: { status: 'DRAFT' },
      newValues: { status: 'SENT' },
    });

    return updated;
  }

  async acknowledgePurchaseOrder(id: string, tenantId: string) {
    const po = await this.repo.findPoById(id, tenantId);
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    return this.repo.updatePoStatus(id, 'ACKNOWLEDGED');
  }

  async closePurchaseOrder(id: string, tenantId: string, userId: string) {
    const po = await this.repo.findPoById(id, tenantId);
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    return this.repo.updatePoStatus(id, 'CLOSED');
  }
}