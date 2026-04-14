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
  CreateBomDto,
  StockAdjustmentDto,
  IssueToProductionDto,
  ReturnFromProductionDto,
  TransferStockDto,
  SetOpeningStockDto,
  MovementFilterDto,
  RebuildBalanceDto,
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
  async listBoms(@CurrentTenant() tenantId: string) {
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
  @ApiOperation({ summary: 'Create a new BOM version (deactivates prior active BOM for the same item/style)' })
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
    @Query('location') location: string | undefined,
    @CurrentTenant() tenantId: string,
  ) {
    return this.inventoryService.listStockBalances(tenantId, location);
  }

  // ── Movement history ──────────────────────────────────────────────────────

  @Get('stock/movements')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER, Role.ACCOUNTANT, Role.PRODUCTION_MGR)
  @ApiOperation({ summary: 'Paginated movement history — filterable by item, location, type, date range' })
  async getMovementHistory(
    @Query() filters: MovementFilterDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.inventoryService.getMovementHistory(filters, tenantId);
  }

  // ── Stock adjustment ──────────────────────────────────────────────────────

  @Post('stock/adjust')
  @HttpCode(HttpStatus.CREATED)
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Manual stock adjustment — positive to add, negative to deduct' })
  async adjustStock(
    @Body() dto: StockAdjustmentDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.inventoryService.adjustStock(dto, tenantId, userId);
  }

  // ── Issue to production ───────────────────────────────────────────────────

  @Post('stock/issue')
  @HttpCode(HttpStatus.CREATED)
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER, Role.PRODUCTION_MGR)
  @ApiOperation({ summary: 'Issue material to production — writes ISSUE_TO_PROD ledger entry' })
  async issueToProduction(
    @Body() dto: IssueToProductionDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.inventoryService.issueToProduction(dto, tenantId, userId);
  }

  // ── Return from production ────────────────────────────────────────────────

  @Post('stock/return')
  @HttpCode(HttpStatus.CREATED)
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER, Role.PRODUCTION_MGR)
  @ApiOperation({ summary: 'Return unused material from production — writes RETURN_FROM_PROD ledger entry' })
  async returnFromProduction(
    @Body() dto: ReturnFromProductionDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.inventoryService.returnFromProduction(dto, tenantId, userId);
  }

  // ── Stock transfer ────────────────────────────────────────────────────────

  @Post('stock/transfer')
  @HttpCode(HttpStatus.CREATED)
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Transfer stock between locations — writes TRANSFER_OUT + TRANSFER_IN entries atomically' })
  async transferStock(
    @Body() dto: TransferStockDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.inventoryService.transferStock(dto, tenantId, userId);
  }

  // ── Opening stock ─────────────────────────────────────────────────────────

  @Post('stock/opening')
  @HttpCode(HttpStatus.CREATED)
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Set opening stock for an item at a location — writes OPENING_STOCK ledger entry' })
  async setOpeningStock(
    @Body() dto: SetOpeningStockDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.inventoryService.setOpeningStock(dto, tenantId, userId);
  }

  // ── Rebuild balance ───────────────────────────────────────────────────────

  @Post('stock/rebuild')
  @HttpCode(HttpStatus.OK)
  @ApiAuth(Role.OWNER)
  @ApiOperation({ summary: 'Rebuild stock balance from ledger SUM — admin reconciliation tool' })
  async rebuildBalance(
    @Body() dto: RebuildBalanceDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.inventoryService.rebuildBalance(dto.itemId, dto.location, tenantId);
  }

  // ── GRN posting ───────────────────────────────────────────────────────────

  @Patch('grn/:grnId/post')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Post a GRN — creates GRN_IN ledger entries, updates stock balances, marks GRN as POSTED' })
  async postGrn(
    @Param('grnId', ParseUUIDPipe) grnId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.inventoryService.postGrn(grnId, tenantId, userId);
  }
}
