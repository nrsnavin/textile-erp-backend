import { Injectable, NotFoundException } from '@nestjs/common';
import { BuyersRepository } from './buyer.repositery';
import { AuditService }     from '../../shared/services/audit.service';
import { CreateBuyerDto, UpdateBuyerDto, BuyerFilterDto } from './dto/buyer.dto';

@Injectable()
export class BuyersService {
  constructor(
    private readonly repo:  BuyersRepository,
    private readonly audit: AuditService,
  ) {}

  async listBuyers(filters: BuyerFilterDto, tenantId: string) {
    return this.repo.findWithFilters(filters, tenantId);
  }

  async getBuyer(id: string, tenantId: string) {
    const buyer = await this.repo.findById(id, tenantId);
    if (!buyer) throw new NotFoundException(`Buyer ${id} not found`);
    return buyer;
  }

  async createBuyer(dto: CreateBuyerDto, tenantId: string, userId: string) {
    const buyer = await this.repo.create(dto, tenantId) as any;
    await this.audit.log({
      tenantId, userId,
      action: 'CREATE', tableName: 'buyers', recordId: buyer.id,
      newValues: {
        name:         buyer.name,
        country:      buyer.country,
        paymentTerms: buyer.paymentTerms,
        segment:      buyer.segment,
      },
    });
    return buyer;
  }

  async updateBuyer(id: string, dto: UpdateBuyerDto, tenantId: string, userId: string) {
    const existing = await this.repo.findById(id, tenantId);
    if (!existing) throw new NotFoundException(`Buyer ${id} not found`);
    const updated = await this.repo.update(id, tenantId, dto);
    await this.audit.log({
      tenantId, userId,
      action: 'UPDATE', tableName: 'buyers', recordId: id,
      oldValues: { name: existing.name, country: existing.country },
      newValues: { name: updated.name, country: updated.country },
    });
    return updated;
  }

  async deleteBuyer(id: string, tenantId: string, userId: string) {
    const existing = await this.repo.findById(id, tenantId);
    if (!existing) throw new NotFoundException(`Buyer ${id} not found`);
    await this.repo.delete(id, tenantId);
    await this.audit.log({
      tenantId, userId,
      action: 'DELETE', tableName: 'buyers', recordId: id,
      oldValues: { name: existing.name, isActive: true },
      newValues: { isActive: false },
    });
    return { message: 'Buyer deactivated successfully' };
  }

  async reactivateBuyer(id: string, tenantId: string, userId: string) {
    const existing = await this.repo.findById(id, tenantId);
    if (!existing) throw new NotFoundException(`Buyer ${id} not found`);
    const updated = await this.repo.reactivate(id, tenantId);
    await this.audit.log({
      tenantId, userId,
      action: 'UPDATE', tableName: 'buyers', recordId: id,
      oldValues: { isActive: false },
      newValues: { isActive: true },
    });
    return updated;
  }

  async getBuyerStats(id: string, tenantId: string) {
    const buyer = await this.repo.findById(id, tenantId);
    if (!buyer) throw new NotFoundException(`Buyer ${id} not found`);
    const stats = await this.repo.getStats(id, tenantId);
    return { buyerId: id, ...stats };
  }

  async getBuyerAuditHistory(id: string, tenantId: string) {
    const buyer = await this.repo.findById(id, tenantId);
    if (!buyer) throw new NotFoundException(`Buyer ${id} not found`);
    return this.audit.getHistory(tenantId, 'buyers', id);
  }
}
