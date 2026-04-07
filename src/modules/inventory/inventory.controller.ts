import {
  Controller, Get, Post, Patch,
  Param, Body, Query, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation }      from '@nestjs/swagger';
import { InventoryService }           from './inventory.service';
import { ApiAuth }                    from '../../shared/decorators/api-auth.decorator';
import { CurrentTenant, CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Role }                       from '../../shared/guards/roles.guard';
import {
  CreateBomDto, StockAdjustmentDto, StockFilterDto,
} from './dto/inventory.dto';

@ApiTags('Inventory')
@ApiAuth()
@Controller('api/v1/inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // ── BOMs ──────────────────────────────────────────────────────────────────

  @Get('boms')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER, Role.PRODUCTION_MGR)
  @ApiOperation({ summary: 'List all Bills of Materials for the tenant' })
  async listBoms(
    @CurrentTenant() tenantId: string,
  ) {
    return this.inventoryService.listBoms(tenantId);
  }

  @Get('boms/:id')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER, Role.PRODUCTION_MGR)
  @ApiOperation({ summary: 'Get a BOM with all lines and raw-item details' })
  async getBom(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
  ) {
    return this.inventoryService.getBom(id, tenantId);
  }

  @Post('boms')
  @HttpCode(HttpStatus.CREATED)
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({
    summary: 'Create a new BOM version (deactivates prior active BOM for the same item/style)',
  })
  async createBom(
    @Body() dto: CreateBomDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.inventoryService.createBom(dto, tenantId, userId);
  }

  // ── Stock balances ────────────────────────────────────────────────────────

  @Get('stock')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER, Role.PRODUCTION_MGR, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'List current stock balances (on-hand, reserved, available) per item/location' })
  async listStockBalances(
    @Query() filters: StockFilterDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.inventoryService.listStockBalances(tenantId, filters.location);
  }

  @Get('stock/ledger')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'Get paginated stock ledger entries — optionally filtered by item' })
  async getStockLedger(
    @Query() filters: StockFilterDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.inventoryService.getStockLedger(
      tenantId,
      filters.itemId,
      filters.page,
      filters.limit,
    );
  }

  // ── Adjustments ───────────────────────────────────────────────────────────

  @Post('stock/adjust')
  @HttpCode(HttpStatus.CREATED)
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({
    summary: 'Create a manual stock adjustment — writes ledger entry and updates balance',
  })
  async adjustStock(
    @Body() dto: StockAdjustmentDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.inventoryService.adjustStock(dto, tenantId, userId);
  }

  // ── GRN posting ───────────────────────────────────────────────────────────

  @Patch('grn/:grnId/post')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({
    summary: 'Post a GRN — creates GRN_IN ledger entries, updates stock balances, marks GRN as POSTED',
  })
  async postGrn(
    @Param('grnId', ParseUUIDPipe) grnId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.inventoryService.postGrn(grnId, tenantId, userId);
  }
}
