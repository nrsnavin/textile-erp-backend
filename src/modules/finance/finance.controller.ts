// src/modules/finance/finance.controller.ts
import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { FinanceService }        from './finance.service';
import { EInvoiceService }       from './einvoice/einvoice.service';
import { ApiAuth }               from '../../shared/decorators/api-auth.decorator';
import { CurrentTenant, CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Role }                  from '../../shared/guards/roles.guard';
import {
  CreateInvoiceDto, UpdateInvoiceDto, InvoiceFilterDto,
  CreatePaymentDto, PaymentFilterDto, ArApFilterDto,
  InvoiceType,
} from './dto/finance.dto';
import { GenerateIrnDto, CancelIrnDto } from './einvoice/einvoice.dto';

@ApiTags('Finance')
@ApiAuth()
@Controller('api/v1/finance')
export class FinanceController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly einvoiceService: EInvoiceService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // INVOICES — /api/v1/finance/invoices
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('invoices')
  @ApiAuth(Role.OWNER, Role.ACCOUNTANT, Role.MERCHANDISER)
  @ApiOperation({ summary: 'List invoices with filters (status, type, buyer, date range, search)' })
  async listInvoices(
    @Query() filters: InvoiceFilterDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.financeService.listInvoices(filters, tenantId);
  }

  @Get('invoices/:id')
  @ApiAuth(Role.OWNER, Role.ACCOUNTANT, Role.MERCHANDISER)
  @ApiOperation({ summary: 'Get a single invoice with lines, buyer, and payments' })
  async getInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
  ) {
    return this.financeService.getInvoice(id, tenantId);
  }

  @Get('invoices/:id/audit')
  @ApiAuth(Role.OWNER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'Get full audit trail for an invoice' })
  async getInvoiceAuditHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
  ) {
    return this.financeService.getInvoiceAuditHistory(id, tenantId);
  }

  @Post('invoices')
  @HttpCode(HttpStatus.CREATED)
  @ApiAuth(Role.OWNER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'Create invoice with auto-computed GST (CGST/SGST or IGST)' })
  async createInvoice(
    @Body() dto: CreateInvoiceDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.financeService.createInvoice(dto, tenantId, userId);
  }

  @Patch('invoices/:id')
  @ApiAuth(Role.OWNER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'Update invoice (status transitions, due date, IRN)' })
  async updateInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvoiceDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.financeService.updateInvoice(id, dto, tenantId, userId);
  }

  @Delete('invoices/:id')
  @ApiAuth(Role.OWNER)
  @ApiOperation({ summary: 'Cancel an invoice (only if no payments recorded)' })
  async cancelInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.financeService.cancelInvoice(id, tenantId, userId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAYMENTS — /api/v1/finance/payments
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('payments')
  @ApiAuth(Role.OWNER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'List payments with filters (invoice, mode, date range)' })
  async listPayments(
    @Query() filters: PaymentFilterDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.financeService.listPayments(filters, tenantId);
  }

  @Get('payments/:id')
  @ApiAuth(Role.OWNER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'Get a single payment with linked invoice' })
  async getPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
  ) {
    return this.financeService.getPayment(id, tenantId);
  }

  @Post('payments')
  @HttpCode(HttpStatus.CREATED)
  @ApiAuth(Role.OWNER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'Record a payment against an invoice (auto-reconciles paid amount + status)' })
  async recordPayment(
    @Body() dto: CreatePaymentDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.financeService.recordPayment(dto, tenantId, userId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AR / AP — /api/v1/finance/ar, /ap
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('ar/summary')
  @ApiAuth(Role.OWNER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'Accounts Receivable summary — total invoiced, paid, outstanding (SALES)' })
  async getArSummary(
    @Query() filters: ArApFilterDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.financeService.getArSummary(tenantId, filters);
  }

  @Get('ap/summary')
  @ApiAuth(Role.OWNER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'Accounts Payable summary — total invoiced, paid, outstanding (PURCHASE)' })
  async getApSummary(
    @Query() filters: ArApFilterDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.financeService.getApSummary(tenantId, filters);
  }

  @Get('aging')
  @ApiAuth(Role.OWNER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'Aging buckets — current, 1-30, 31-60, 60+ days overdue' })
  async getAgingReport(
    @Query('type') type: InvoiceType | undefined,
    @CurrentTenant() tenantId: string,
  ) {
    return this.financeService.getAgingReport(tenantId, type);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GST PREVIEW — /api/v1/finance/gst/preview
  // ═══════════════════════════════════════════════════════════════════════════

  @Post('gst/preview')
  @HttpCode(HttpStatus.OK)
  @ApiAuth(Role.OWNER, Role.ACCOUNTANT, Role.MERCHANDISER)
  @ApiOperation({ summary: 'Preview GST calculation for line items (no persistence)' })
  async previewGst(
    @Body() body: { lines: Array<{ qty: number; rate: number; gstPct?: number; hsnCode?: string }>; isInterState?: boolean },
  ) {
    return this.financeService.previewGst(body.lines, body.isInterState ?? false);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // E-INVOICE (NIC API) — /api/v1/finance/einvoice
  // ═══════════════════════════════════════════════════════════════════════════

  @Post('einvoice/generate')
  @HttpCode(HttpStatus.OK)
  @ApiAuth(Role.OWNER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'Generate IRN via NIC e-Invoice API (sandbox)' })
  async generateIrn(
    @Body() dto: GenerateIrnDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.financeService.generateEInvoice(dto, tenantId, userId);
  }

  @Post('einvoice/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiAuth(Role.OWNER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'Cancel IRN via NIC e-Invoice API (within 24h of generation)' })
  async cancelIrn(
    @Body() dto: CancelIrnDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.financeService.cancelEInvoice(dto, tenantId, userId);
  }

  @Get('einvoice/:id')
  @ApiAuth(Role.OWNER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'Get IRN details for an invoice' })
  async getIrnDetails(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
  ) {
    return this.financeService.getEInvoiceDetails(id, tenantId);
  }
}
