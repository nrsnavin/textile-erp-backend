import {
  Controller, Get, Post, Patch, Param,
  Body, Query, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation }       from '@nestjs/swagger';
import { SuppliersService }            from './suppliers.service';
import { ApiAuth }                     from '../../shared/decorators/api-auth.decorator';
import { CurrentTenant, CurrentUser }  from '../../shared/decorators/current-user.decorator';
import { Role }                        from '../../shared/guards/roles.guard';
import {
  CreateSupplierDto, UpdateSupplierDto, SupplierFilterDto,
  CreatePurchaseOrderDto, PoFilterDto,
} from './dto/supplier.dto';

@ApiTags('Suppliers')
@ApiAuth()
@Controller('api/v1/suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'List all suppliers' })
  async listSuppliers(
    @Query() filters: SupplierFilterDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.suppliersService.listSuppliers(filters, tenantId);
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

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Create a new supplier' })
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

  @Get('purchase-orders')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'List all purchase orders' })
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

  @Post('purchase-orders')
  @HttpCode(HttpStatus.CREATED)
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Create a purchase order' })
  async createPurchaseOrder(
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.suppliersService.createPurchaseOrder(dto, tenantId, userId);
  }

  @Patch('purchase-orders/:id/send')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Send PO to supplier' })
  async sendPurchaseOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.suppliersService.sendPurchaseOrder(id, tenantId, userId);
  }

  @Patch('purchase-orders/:id/acknowledge')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Mark PO as acknowledged by supplier' })
  async acknowledgePurchaseOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
  ) {
    return this.suppliersService.acknowledgePurchaseOrder(id, tenantId);
  }

  @Patch('purchase-orders/:id/close')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Close a purchase order' })
  async closePurchaseOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.suppliersService.closePurchaseOrder(id, tenantId, userId);
  }
}