import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsArray, IsUUID, IsDateString,
  IsNumber, IsObject, Min, ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { PartialType }     from '@nestjs/swagger';
import { PaginationDto }   from '../../../shared/utils/pagination.util';

// ── OrderLineDto ──────────────────────────────────────────────────────────────

export class OrderLineDto {
  @ApiProperty({ description: 'Style code for this line (e.g. SS24-001)' })
  @IsString()
  styleCode!: string;

  @ApiProperty({ description: 'Item master UUID' })
  @IsUUID()
  itemId!: string;

  @ApiPropertyOptional({ description: 'Colour / colorway name' })
  @IsOptional()
  @IsString()
  colour?: string;

  @ApiProperty({ description: 'Total order quantity for this line', minimum: 1 })
  @IsNumber()
  @Min(1)
  qty!: number;

  @ApiProperty({
    description: 'Size breakdown — keys are size labels, values are quantities',
    example: { S: 10, M: 20, L: 15, XL: 5 },
  })
  @IsObject()
  sizesJson!: Record<string, number>;

  @ApiPropertyOptional({ description: 'Unit price (FOB / ex-factory)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional({ description: 'Currency code', default: 'USD', example: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;
}

// ── CreateOrderDto ────────────────────────────────────────────────────────────

export class CreateOrderDto {
  @ApiProperty({ description: 'Buyer UUID' })
  @IsUUID()
  buyerId!: string;

  @ApiProperty({ description: 'Buyer PO / reference number', example: 'PO-2024-00123' })
  @IsString()
  poNumber!: string;

  @ApiProperty({ description: 'Requested delivery date (ISO 8601)', example: '2024-09-30' })
  @IsDateString()
  deliveryDate!: string;

  @ApiPropertyOptional({ description: 'Season / collection label', example: 'SS25' })
  @IsOptional()
  @IsString()
  season?: string;

  @ApiPropertyOptional({ description: 'Free-text remarks / special instructions' })
  @IsOptional()
  @IsString()
  remarks?: string;

  @ApiProperty({ type: [OrderLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines!: OrderLineDto[];
}

// ── UpdateOrderDto ────────────────────────────────────────────────────────────

export class UpdateOrderDto extends PartialType(CreateOrderDto) {
  @ApiPropertyOptional({
    description: 'Reason for this revision — stored in OrderRevision.reason',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

// ── OrderFilterDto ────────────────────────────────────────────────────────────

export class OrderFilterDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filter by order status',
    example: 'CONFIRMED',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by buyer UUID' })
  @IsOptional()
  @IsUUID()
  buyerId?: string;

  @ApiPropertyOptional({ description: 'Full-text search on PO number, season, remarks' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter orders on or after this date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Filter orders on or before this date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
