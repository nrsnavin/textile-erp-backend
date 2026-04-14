import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsArray, IsUUID,
  IsNumber, IsPositive, Min, ValidateNested,
  IsIn, IsNotIn, MinLength,
} from 'class-validator';
import { Type }          from 'class-transformer';
import { PaginationDto } from '../../../shared/utils/pagination.util';

const LEDGER_ENTRY_TYPES = [
  'GRN_IN', 'ISSUE_TO_PROD', 'RETURN_FROM_PROD',
  'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'OPENING_STOCK',
] as const;

// ── BomLineDto ────────────────────────────────────────────────────────────────

export class BomLineDto {
  @ApiProperty({ description: 'Raw material item UUID' })
  @IsUUID()
  rawItemId!: string;

  @ApiProperty({ description: 'Quantity required per finished unit', minimum: 0.0001 })
  @IsNumber()
  @IsPositive()
  qty!: number;

  @ApiProperty({ description: 'Unit of measure (e.g. MTR, KGS, PCS)', example: 'MTR' })
  @IsString()
  unit!: string;

  @ApiPropertyOptional({
    description: 'Wastage percentage added on top of qty (e.g. 5 means 5%)',
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  wastagePct?: number;

  @ApiPropertyOptional({ description: 'Optional line-level remarks' })
  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── CreateBomDto ──────────────────────────────────────────────────────────────

export class CreateBomDto {
  @ApiProperty({ description: 'Finished-goods item UUID this BOM belongs to' })
  @IsUUID()
  itemId!: string;

  @ApiPropertyOptional({ description: 'Style code the BOM is linked to', example: 'SS24-TEE-001' })
  @IsOptional()
  @IsString()
  styleCode?: string;

  @ApiPropertyOptional({ description: 'General remarks about this BOM version' })
  @IsOptional()
  @IsString()
  remarks?: string;

  @ApiProperty({ type: [BomLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BomLineDto)
  lines!: BomLineDto[];
}

// ── StockAdjustmentDto ────────────────────────────────────────────────────────

export class StockAdjustmentDto {
  @ApiProperty({ description: 'Item UUID to adjust' })
  @IsUUID()
  itemId!: string;

  @ApiPropertyOptional({ description: 'Warehouse location code', default: 'MAIN' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({
    description: 'Signed quantity — positive to add, negative to deduct. Must not be zero.',
    example: 50,
  })
  @IsNumber()
  @IsNotIn([0], { message: 'qty must not be zero' })
  qty!: number;

  @ApiProperty({ description: 'Mandatory reason for the adjustment (audit trail)' })
  @IsString()
  reason!: string;

}

// ── IssueToProductionDto ──────────────────────────────────────────────────────

export class IssueToProductionDto {
  @ApiProperty({ description: 'Item UUID to issue' })
  @IsUUID()
  itemId!: string;

  @ApiPropertyOptional({ description: 'Warehouse location code', default: 'MAIN' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({ description: 'Quantity to issue (always treated as OUT)', example: 30 })
  @IsNumber()
  @IsPositive()
  qty!: number;

  @ApiPropertyOptional({ description: 'Production order UUID this issue is linked to' })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({ description: 'Optional remarks' })
  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── ReturnFromProductionDto ───────────────────────────────────────────────────

export class ReturnFromProductionDto {
  @ApiProperty({ description: 'Item UUID being returned' })
  @IsUUID()
  itemId!: string;

  @ApiPropertyOptional({ description: 'Warehouse location code', default: 'MAIN' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({ description: 'Quantity to return (always treated as IN)', example: 5 })
  @IsNumber()
  @IsPositive()
  qty!: number;

  @ApiPropertyOptional({ description: 'Production order UUID this return is linked to' })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({ description: 'Optional remarks' })
  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── TransferStockDto ──────────────────────────────────────────────────────────

export class TransferStockDto {
  @ApiProperty({ description: 'Item UUID to transfer' })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ description: 'Source location code', example: 'WAREHOUSE-A' })
  @IsString()
  @MinLength(1, { message: 'fromLocation must not be empty' })
  fromLocation!: string;

  @ApiProperty({ description: 'Destination location code', example: 'STORE-1' })
  @IsString()
  @MinLength(1, { message: 'toLocation must not be empty' })
  toLocation!: string;

  @ApiProperty({ description: 'Quantity to transfer', example: 20 })
  @IsNumber()
  @IsPositive()
  qty!: number;

  @ApiPropertyOptional({ description: 'Optional remarks' })
  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── SetOpeningStockDto ────────────────────────────────────────────────────────

export class SetOpeningStockDto {
  @ApiProperty({ description: 'Item UUID' })
  @IsUUID()
  itemId!: string;

  @ApiPropertyOptional({ description: 'Warehouse location code', default: 'MAIN' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({ description: 'Opening stock quantity (must be positive)', example: 100 })
  @IsNumber()
  @IsPositive()
  qty!: number;

  @ApiPropertyOptional({ description: 'Cost rate per unit for valuation' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  rate?: number;

  @ApiPropertyOptional({ description: 'Optional remarks' })
  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── MovementFilterDto ─────────────────────────────────────────────────────────

export class MovementFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by item UUID' })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({ description: 'Filter by warehouse location code', example: 'MAIN' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({
    description: 'Filter by entry type',
    enum: LEDGER_ENTRY_TYPES,
  })
  @IsOptional()
  @IsIn(LEDGER_ENTRY_TYPES, { message: `entryType must be one of: ${LEDGER_ENTRY_TYPES.join(', ')}` })
  entryType?: string;

  @ApiPropertyOptional({ description: 'Filter from date (ISO 8601)', example: '2026-01-01' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Filter to date (ISO 8601)', example: '2026-12-31' })
  @IsOptional()
  @IsString()
  dateTo?: string;
}

// ── RebuildBalanceDto ─────────────────────────────────────────────────────────

export class RebuildBalanceDto {
  @ApiProperty({ description: 'Item UUID to rebuild balance for' })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ description: 'Warehouse location code', example: 'MAIN' })
  @IsString()
  @MinLength(1, { message: 'location must not be empty' })
  location!: string;
}
