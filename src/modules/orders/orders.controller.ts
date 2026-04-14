import {
  Controller, Get, Post, Patch,
  Param, Body, Query, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation }      from '@nestjs/swagger';
import { OrdersService }              from './orders.service';
import { ApiAuth }                    from '../../shared/decorators/api-auth.decorator';
import { CurrentTenant, CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Role }                       from '../../shared/guards/roles.guard';
import {
  CreateOrderDto, UpdateOrderDto, OrderFilterDto,
} from './dto/order.dto';

@ApiTags('Orders')
@ApiAuth()
@Controller('api/v1/orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // ── List ──────────────────────────────────────────────────────────────────

  @Get()
  @ApiAuth(Role.OWNER, Role.MERCHANDISER, Role.PRODUCTION_MGR, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'List orders with pagination and filters (status, buyer, date range, search)' })
  async listOrders(
    @Query() filters: OrderFilterDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.ordersService.listOrders(filters, tenantId);
  }

  // ── Get single ────────────────────────────────────────────────────────────

  @Get(':id')
  @ApiAuth(Role.OWNER, Role.MERCHANDISER, Role.PRODUCTION_MGR, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'Get a single order with lines, revisions, and buyer details' })
  async getOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
  ) {
    return this.ordersService.getOrder(id, tenantId);
  }

  // ── Create ────────────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiAuth(Role.OWNER, Role.MERCHANDISER)
  @ApiOperation({ summary: 'Create a new order with lines (starts in DRAFT status)' })
  async createOrder(
    @Body() dto: CreateOrderDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.ordersService.createOrder(dto, tenantId, userId);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  @Patch(':id')
  @ApiAuth(Role.OWNER, Role.MERCHANDISER)
  @ApiOperation({
    summary: 'Update order fields/lines — automatically creates an OrderRevision snapshot',
  })
  async updateOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.ordersService.updateOrder(id, dto, tenantId, userId);
  }

  // ── State transitions ─────────────────────────────────────────────────────

  @Patch(':id/confirm')
  @ApiAuth(Role.OWNER, Role.MERCHANDISER)
  @ApiOperation({ summary: 'Confirm order (DRAFT → CONFIRMED), freezes the lines snapshot' })
  async confirmOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.ordersService.confirmOrder(id, tenantId, userId);
  }

  @Patch(':id/cancel')
  @ApiAuth(Role.OWNER, Role.MERCHANDISER)
  @ApiOperation({ summary: 'Cancel order (any status except DISPATCHED → CANCELLED)' })
  async cancelOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.ordersService.cancelOrder(id, tenantId, userId);
  }

  @Patch(':id/dispatch')
  @ApiAuth(Role.OWNER, Role.MERCHANDISER)
  @ApiOperation({ summary: 'Dispatch order (QC_PASSED → DISPATCHED)' })
  async dispatchOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.ordersService.dispatchOrder(id, tenantId, userId);
  }
}
