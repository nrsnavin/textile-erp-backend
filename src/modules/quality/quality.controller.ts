// src/modules/quality/quality.controller.ts
import {
  Controller, Get, Post, Patch,
  Param, Body, Query, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { QualityService }        from './quality.service';
import { ApiAuth }               from '../../shared/decorators/api-auth.decorator';
import { CurrentTenant, CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Role }                  from '../../shared/guards/roles.guard';
import {
  CreateQcInspectionDto,
  UpdateQcInspectionDto,
  QcFilterDto,
} from './dto/quality.dto';

@ApiTags('Quality')
@ApiAuth()
@Controller('api/v1/quality')
export class QualityController {
  constructor(private readonly qualityService: QualityService) {}

  // ── Dashboard ─────────────────────────────────────────────────────────────

  @Get('dashboard')
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.QC_INSPECTOR)
  @ApiOperation({ summary: 'Get QC dashboard stats (pass rate, defect avg, counts)' })
  async getDashboard(@CurrentTenant() tenantId: string) {
    return this.qualityService.getDashboardStats(tenantId);
  }

  // ── List inspections ──────────────────────────────────────────────────────

  @Get('inspections')
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.QC_INSPECTOR)
  @ApiOperation({ summary: 'List QC inspections with filters' })
  async listInspections(
    @Query() filters: QcFilterDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.qualityService.listInspections(filters, tenantId);
  }

  // ── Get single inspection ─────────────────────────────────────────────────

  @Get('inspections/:id')
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.QC_INSPECTOR)
  @ApiOperation({ summary: 'Get QC inspection by ID' })
  async getInspection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
  ) {
    return this.qualityService.getInspection(id, tenantId);
  }

  // ── Inspections by order ──────────────────────────────────────────────────

  @Get('orders/:orderId/inspections')
  @ApiAuth(Role.OWNER, Role.PRODUCTION_MGR, Role.QC_INSPECTOR)
  @ApiOperation({ summary: 'Get all inspections for an order' })
  async getInspectionsByOrder(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @CurrentTenant() tenantId: string,
  ) {
    return this.qualityService.getInspectionsByOrder(orderId, tenantId);
  }

  // ── Create inspection ─────────────────────────────────────────────────────

  @Post('inspections')
  @ApiAuth(Role.OWNER, Role.QC_INSPECTOR)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new QC inspection' })
  async createInspection(
    @Body() dto: CreateQcInspectionDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ) {
    return this.qualityService.createInspection(dto, tenantId, userId);
  }

  // ── Update inspection ─────────────────────────────────────────────────────

  @Patch('inspections/:id')
  @ApiAuth(Role.OWNER, Role.QC_INSPECTOR)
  @ApiOperation({ summary: 'Update QC inspection (result, defects, notes)' })
  async updateInspection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQcInspectionDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ) {
    return this.qualityService.updateInspection(id, dto, tenantId, userId);
  }
}
