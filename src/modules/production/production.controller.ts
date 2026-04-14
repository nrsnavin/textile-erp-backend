// src/modules/production/production.controller.ts
import {
  Controller, Get, Post, Patch,
  Param, Body, Query, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ProductionService }     from './production.service';
import { ApiAuth }               from '../../shared/decorators/api-auth.decorator';
import { CurrentTenant, CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Role }                  from '../../shared/guards/roles.guard';
import {
  CreateCutOrderDto, UpdateCutOrderDto, CutOrderFilterDto,
  CreateLinePlanDto, UpdateLinePlanDto, LinePlanFilterDto,
  CreateWipRecordDto, UpdateWipRecordDto, WipFilterDto,
} from './dto/production.dto';

@ApiTags('Production')
@ApiAuth()
@Controller('api/v1/production')
export class ProductionController {
  constructor(private readonly productionService: ProductionService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('dashboard')
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.SUPERVISOR)
  @ApiOperation({ summary: 'Get production dashboard stats' })
  async getDashboard(@CurrentTenant() tenantId: string) {
    return this.productionService.getDashboardStats(tenantId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CUT ORDERS
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('cut-orders')
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.SUPERVISOR)
  @ApiOperation({ summary: 'List cut orders with filters' })
  async listCutOrders(
    @Query() filters: CutOrderFilterDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.productionService.listCutOrders(filters, tenantId);
  }

  @Get('cut-orders/:id')
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.SUPERVISOR)
  @ApiOperation({ summary: 'Get a single cut order' })
  async getCutOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
  ) {
    return this.productionService.getCutOrder(id, tenantId);
  }

  @Post('cut-orders')
  @HttpCode(HttpStatus.CREATED)
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR)
  @ApiOperation({ summary: 'Create a new cut order' })
  async createCutOrder(
    @Body() dto: CreateCutOrderDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.productionService.createCutOrder(dto, tenantId, userId);
  }

  @Patch('cut-orders/:id')
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.SUPERVISOR)
  @ApiOperation({ summary: 'Update cut order (qty, status, consumption)' })
  async updateCutOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCutOrderDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.productionService.updateCutOrder(id, dto, tenantId, userId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LINE PLANS
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('line-plans')
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.SUPERVISOR)
  @ApiOperation({ summary: 'List line plans with filters' })
  async listLinePlans(
    @Query() filters: LinePlanFilterDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.productionService.listLinePlans(filters, tenantId);
  }

  @Get('line-plans/:id')
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.SUPERVISOR)
  @ApiOperation({ summary: 'Get a single line plan' })
  async getLinePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
  ) {
    return this.productionService.getLinePlan(id, tenantId);
  }

  @Post('line-plans')
  @HttpCode(HttpStatus.CREATED)
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR)
  @ApiOperation({ summary: 'Create a new line plan' })
  async createLinePlan(
    @Body() dto: CreateLinePlanDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.productionService.createLinePlan(dto, tenantId, userId);
  }

  @Patch('line-plans/:id')
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.SUPERVISOR)
  @ApiOperation({ summary: 'Update line plan (achieved qty, efficiency, status)' })
  async updateLinePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLinePlanDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.productionService.updateLinePlan(id, dto, tenantId, userId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WIP RECORDS
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('wip')
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.SUPERVISOR, Role.QC_INSPECTOR)
  @ApiOperation({ summary: 'List WIP records with filters' })
  async listWipRecords(
    @Query() filters: WipFilterDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.productionService.listWipRecords(filters, tenantId);
  }

  @Get('wip/:id')
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.SUPERVISOR, Role.QC_INSPECTOR)
  @ApiOperation({ summary: 'Get a single WIP record' })
  async getWipRecord(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
  ) {
    return this.productionService.getWipRecord(id, tenantId);
  }

  @Post('wip')
  @HttpCode(HttpStatus.CREATED)
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.SUPERVISOR)
  @ApiOperation({ summary: 'Create a new WIP record' })
  async createWipRecord(
    @Body() dto: CreateWipRecordDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.productionService.createWipRecord(dto, tenantId, userId);
  }

  @Patch('wip/:id')
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.SUPERVISOR)
  @ApiOperation({ summary: 'Update WIP record (output qty, reject qty)' })
  async updateWipRecord(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWipRecordDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.productionService.updateWipRecord(id, dto, tenantId, userId);
  }
}
