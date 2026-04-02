import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation }       from '@nestjs/swagger';
import { SuppliersService }            from './suppliers.service';
import { ApiAuth }                     from '../../shared/decorators/api-auth.decorator';
import { CurrentTenant, CurrentUser }  from '../../shared/decorators/current-user.decorator';
import { Role }                        from '../../shared/guards/roles.guard';
import {
  CreateSupplierDto, UpdateSupplierDto, SupplierFilterDto,
  CreatePurchaseOrderDto, UpdatePoLineDto, PoFilterDto,
} from './dto/supplier.dto';

@ApiTags('Suppliers')
@ApiAuth()
@Controller('api/v1/suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  // ── Supplier master ────────────────────────────────────────────────────

  @Get()
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'List all suppliers (filter by service, payment terms, active status)' })
  async listSuppliers(
    @Query() filters: SupplierFilterDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.suppliersService.listSuppliers(filters, tenantId);
  }

  @Get('purchase-orders')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'List all purchase orders across suppliers' })
  async listPurchaseOrders(
    @Query() filters: PoFilterDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.suppliersService.listPurchaseOrders(filters, tenantId);
  }

  @Get('purchase-orders/:id')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'Get a purchase order with all lines' })
  async getPurchaseOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
  ) {
    return this.suppliersService.getPurchaseOrder(id, tenantId);
  }

  @Get(':id')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'Get a single supplier' })
  async getSupplier(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
  ) {
    return this.suppliersService.getSupplier(id, tenantId);
  }

  @Get(':id/stats')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'Get supplier statistics — PO count, vendor score' })
  async getSupplierStats(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
  ) {
    return this.suppliersService.getSupplierStats(id, tenantId);
  }

  @Get(':id/audit')
  @ApiAuth(Role.OWNER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'Get full audit trail for a supplier' })
  async getSupplierAuditHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
  ) {
    return this.suppliersService.getSupplierAuditHistory(id, tenantId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Create a new supplier (with GST, PAN, bank details, payment terms)' })
  async createSupplier(
    @Body() dto: CreateSupplierDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.suppliersService.createSupplier(dto, tenantId, userId);
  }

  @Patch(':id')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Update supplier details' })
  async updateSupplier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.suppliersService.updateSupplier(id, dto, tenantId, userId);
  }

  @Delete(':id')
  @ApiAuth(Role.OWNER)
  @ApiOperation({ summary: 'Deactivate a supplier (soft delete)' })
  async deactivateSupplier(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.suppliersService.deactivateSupplier(id, tenantId, userId);
  }

  // ── Purchase Orders ────────────────────────────────────────────────────

  @Post('purchase-orders')
  @HttpCode(HttpStatus.CREATED)
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Create a purchase order (auto-generates PO number)' })
  async createPurchaseOrder(
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.suppliersService.createPurchaseOrder(dto, tenantId, userId);
  }

  @Patch('purchase-orders/:id/lines')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Update PO lines (only allowed on DRAFT POs)' })
  async updatePurchaseOrderLines(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() lines: Array<{ id: string } & UpdatePoLineDto>,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.suppliersService.updatePurchaseOrderLines(id, lines, tenantId, userId);
  }

  @Patch('purchase-orders/:id/send')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Send PO to supplier (DRAFT → SENT, fires Kafka event)' })
  async sendPurchaseOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.suppliersService.sendPurchaseOrder(id, tenantId, userId);
  }

  @Patch('purchase-orders/:id/acknowledge')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Mark PO as acknowledged by supplier (SENT → ACKNOWLEDGED)' })
  async acknowledgePurchaseOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.suppliersService.acknowledgePurchaseOrder(id, tenantId, userId);
  }

  @Patch('purchase-orders/:id/close')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Close a purchase order (ACKNOWLEDGED/PART_RECEIVED → CLOSED)' })
  async closePurchaseOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.suppliersService.closePurchaseOrder(id, tenantId, userId);
  }

  @Patch('purchase-orders/:id/cancel')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Cancel a purchase order (any status except CLOSED/CANCELLED)' })
  async cancelPurchaseOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.suppliersService.cancelPurchaseOrder(id, tenantId, userId);
  }
}
