// src/modules/mrp/mrp.controller.ts
import {
  Controller, Get, Post, Patch,
  Param, Body, Query, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MrpService }           from './mrp.service';
import { ApiAuth }              from '../../shared/decorators/api-auth.decorator';
import { CurrentTenant, CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Role }                 from '../../shared/guards/roles.guard';
import {
  CreateBomDto, UpdateBomDto, RunMrpDto,
  MrpRunFilterDto, PrFilterDto, ApprovePrDto, UpsertStockDto,
} from './dto/mrp.dto';

@ApiTags('MRP')
@ApiAuth()
@Controller('api/v1/mrp')
export class MrpController {
  constructor(private readonly mrpService: MrpService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // BOM — /api/v1/mrp/bom
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('bom')
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'List all active BOMs' })
  async listBoms(@CurrentTenant() tenantId: string) {
    return this.mrpService.listBoms(tenantId);
  }

  @Get('bom/:id')
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Get a BOM with all component lines' })
  async getBom(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
  ) {
    return this.mrpService.getBom(id, tenantId);
  }

  @Post('bom')
  @HttpCode(HttpStatus.CREATED)
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR)
  @ApiOperation({ summary: 'Create a new Bill of Materials for a finished good' })
  async createBom(
    @Body() dto: CreateBomDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.mrpService.createBom(dto, tenantId, userId);
  }

  @Patch('bom/:id')
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR)
  @ApiOperation({ summary: 'Update BOM (replace lines, toggle active, remarks)' })
  async updateBom(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBomDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.mrpService.updateBom(id, dto, tenantId, userId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MRP RUN — /api/v1/mrp/run
  // ═══════════════════════════════════════════════════════════════════════════

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Execute MRP calculation — BOM explosion, stock netting, PR generation' })
  async runMrp(
    @Body() dto: RunMrpDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.mrpService.runMrp(dto, tenantId, userId);
  }

  @Get('run')
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'List MRP run history' })
  async listMrpRuns(
    @Query() filters: MrpRunFilterDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.mrpService.listMrpRuns(filters, tenantId);
  }

  @Get('run/:id')
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Get a single MRP run with lines and requisitions' })
  async getMrpRun(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
  ) {
    return this.mrpService.getMrpRun(id, tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PURCHASE REQUISITIONS — /api/v1/mrp/requisitions
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('requisitions')
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.STORE_MANAGER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'List purchase requisitions with filters' })
  async listPurchaseRequisitions(
    @Query() filters: PrFilterDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.mrpService.listPurchaseRequisitions(filters, tenantId);
  }

  @Post('requisitions/approve')
  @HttpCode(HttpStatus.OK)
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR)
  @ApiOperation({ summary: 'Batch-approve purchase requisitions' })
  async approvePrs(
    @Body() dto: ApprovePrDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.mrpService.approvePrs(dto, tenantId, userId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STOCK — /api/v1/mrp/stock
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('stock')
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER, Role.PRODUCTION_MGR)
  @ApiOperation({ summary: 'List all stock balances' })
  async listStock(@CurrentTenant() tenantId: string) {
    return this.mrpService.listStock(tenantId);
  }

  @Post('stock')
  @HttpCode(HttpStatus.OK)
  @ApiAuth(Role.OWNER, Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Upsert stock balance for an item + location' })
  async upsertStock(
    @Body() dto: UpsertStockDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.mrpService.upsertStock(dto, tenantId);
  }
}
