import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsArray, IsUUID,
  IsNumber, IsPositive, Min, ValidateNested,
} from 'class-validator';
import { Type }          from 'class-transformer';
import { PaginationDto } from '../../../shared/utils/pagination.util';

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

  @ApiPropertyOptional({
    description: 'Warehouse / store location code',
    default: 'MAIN',
    example: 'MAIN',
  })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({
    description: 'Adjustment quantity — positive to add stock, negative to deduct',
    example: 50,
  })
  @IsNumber()
  qty!: number;

  @ApiProperty({ description: 'Mandatory reason for the adjustment (audit trail)' })
  @IsString()
  reason!: string;
}

// ── StockFilterDto ────────────────────────────────────────────────────────────

export class StockFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter ledger by item UUID' })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({
    description: 'Filter by warehouse location code',
    example: 'MAIN',
  })
  @IsOptional()
  @IsString()
  location?: string;
}
