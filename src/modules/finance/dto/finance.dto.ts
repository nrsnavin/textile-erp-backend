// src/modules/finance/dto/finance.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsEnum, IsNumber, IsUUID,
  IsDateString, IsArray, ValidateNested, Min, Max,
  MinLength, MaxLength, IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../../shared/utils/pagination.util';

// ── Enums (match Prisma schema) ───────────────────────────────────────────────

export enum InvoiceStatus {
  DRAFT     = 'DRAFT',
  SENT      = 'SENT',
  PARTIAL   = 'PARTIAL',
  PAID      = 'PAID',
  OVERDUE   = 'OVERDUE',
  CANCELLED = 'CANCELLED',
}

export enum InvoiceType {
  SALES    = 'SALES',
  PURCHASE = 'PURCHASE',
}

export enum PaymentMode {
  BANK_TRANSFER = 'BANK_TRANSFER',
  CHEQUE        = 'CHEQUE',
  CASH          = 'CASH',
  UPI           = 'UPI',
}

// ── Invoice Line DTO ──────────────────────────────────────────────────────────

export class CreateInvoiceLineDto {
  @ApiProperty({ example: 'Cotton fabric 40s count, 58" width' })
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  description!: string;

  @ApiPropertyOptional({ example: '5208' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  hsnCode?: string;

  @ApiProperty({ example: 100, description: 'Quantity' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  qty!: number;

  @ApiProperty({ example: 250.50, description: 'Per-unit rate — Decimal(14,2)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999999999.99)
  @Type(() => Number)
  rate!: number;

  @ApiPropertyOptional({ example: 12, description: 'GST %. If omitted, resolved from HSN code.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(0)
  @Max(28)
  @Type(() => Number)
  gstPct?: number;
}

// ── Create Invoice ────────────────────────────────────────────────────────────

export class CreateInvoiceDto {
  @ApiPropertyOptional({ description: 'Linked order ID' })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({ description: 'Buyer ID (required for SALES invoices)' })
  @IsOptional()
  @IsUUID()
  buyerId?: string;

  @ApiProperty({ enum: InvoiceType, example: 'SALES' })
  @IsEnum(InvoiceType)
  type!: InvoiceType;

  @ApiProperty({ example: 'INV-2026-0001' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  invoiceNo!: string;

  @ApiProperty({ example: '2026-04-13' })
  @IsDateString()
  invoiceDate!: string;

  @ApiProperty({ example: '2026-05-13' })
  @IsDateString()
  dueDate!: string;

  @ApiPropertyOptional({ example: 'INR', default: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ description: 'true if buyer is in a different state (→ IGST instead of CGST+SGST)' })
  @IsOptional()
  @Type(() => Boolean)
  isInterState?: boolean;

  @ApiProperty({ type: [CreateInvoiceLineDto], description: 'Line items' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceLineDto)
  lines!: CreateInvoiceLineDto[];
}

// ── Update Invoice ────────────────────────────────────────────────────────────

export class UpdateInvoiceDto {
  @ApiPropertyOptional({ example: '2026-05-30' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ enum: InvoiceStatus })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @ApiPropertyOptional({ example: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ description: 'e-Invoice IRN number' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  irnNumber?: string;
}

// ── Invoice Filters ───────────────────────────────────────────────────────────

export class InvoiceFilterDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: InvoiceStatus })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @ApiPropertyOptional({ enum: InvoiceType })
  @IsOptional()
  @IsEnum(InvoiceType)
  type?: InvoiceType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  buyerId?: string;

  @ApiPropertyOptional({ description: 'From date (ISO)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'To date (ISO)' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

// ── Create Payment ────────────────────────────────────────────────────────────

export class CreatePaymentDto {
  @ApiProperty({ description: 'Invoice this payment is applied to' })
  @IsUUID()
  invoiceId!: string;

  @ApiProperty({ example: 15000.00, description: 'Payment amount — Decimal(14,2)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999999999999.99)
  @Type(() => Number)
  amount!: number;

  @ApiProperty({ enum: PaymentMode, example: 'BANK_TRANSFER' })
  @IsEnum(PaymentMode)
  mode!: PaymentMode;

  @ApiPropertyOptional({ example: 'UTR-123456789' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @ApiProperty({ example: '2026-04-13T10:00:00Z' })
  @IsDateString()
  paidAt!: string;
}

// ── Payment Filters ───────────────────────────────────────────────────────────

export class PaymentFilterDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @ApiPropertyOptional({ enum: PaymentMode })
  @IsOptional()
  @IsEnum(PaymentMode)
  mode?: PaymentMode;

  @ApiPropertyOptional({ description: 'From date (ISO)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'To date (ISO)' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

// ── AR/AP Summary ─────────────────────────────────────────────────────────────

export class ArApFilterDto {
  @ApiPropertyOptional({ enum: InvoiceType })
  @IsOptional()
  @IsEnum(InvoiceType)
  type?: InvoiceType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  buyerId?: string;
}
