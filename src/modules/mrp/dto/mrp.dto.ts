// src/modules/mrp/dto/mrp.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsEnum, IsNumber, IsUUID,
  IsDateString, IsArray, ValidateNested, IsInt,
  Min, Max, MinLength, MaxLength, IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../../shared/utils/pagination.util';

// ── BOM DTOs ──────────────────────────────────────────────────────────────────

export class CreateBomLineDto {
  @ApiProperty({ description: 'Child (component) item ID' })
  @IsUUID()
  childItemId!: string;

  @ApiProperty({ example: 2.5, description: 'Quantity per 1 unit of parent' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Type(() => Number)
  qtyPer!: number;

  @ApiProperty({ example: 'MTR' })
  @IsString()
  @MaxLength(10)
  unit!: string;

  @ApiPropertyOptional({ example: 3.0, description: 'Wastage allowance %' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(50)
  @Type(() => Number)
  wastePct?: number;

  @ApiPropertyOptional({ example: 14, description: 'Lead time in days' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  @Type(() => Number)
  leadTimeDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  remarks?: string;
}

export class CreateBomDto {
  @ApiProperty({ description: 'Parent (finished good) item ID' })
  @IsUUID()
  parentItemId!: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  version?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;

  @ApiProperty({ type: [CreateBomLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBomLineDto)
  lines!: CreateBomLineDto[];
}

export class UpdateBomLineDto extends CreateBomLineDto {}

export class UpdateBomDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiPropertyOptional({ type: [UpdateBomLineDto], description: 'Replace all lines' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateBomLineDto)
  lines?: UpdateBomLineDto[];
}

// ── Run MRP ───────────────────────────────────────────────────────────────────

export class RunMrpDto {
  @ApiPropertyOptional({ description: 'Specific order IDs to plan. If omitted, all CONFIRMED+IN_PRODUCTION orders are used.' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  orderIds?: string[];

  @ApiPropertyOptional({ example: 10, description: 'Max BOM recursion depth' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  maxDepth?: number;
}

// ── MRP Run Filters ───────────────────────────────────────────────────────────

export class MrpRunFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ['RUNNING', 'COMPLETED', 'FAILED'] })
  @IsOptional()
  @IsString()
  status?: string;
}

// ── Purchase Requisition Filters ──────────────────────────────────────────────

export class PrFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'APPROVED', 'CONVERTED', 'CANCELLED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  mrpRunId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}

// ── Approve / Convert PR ──────────────────────────────────────────────────────

export class ApprovePrDto {
  @ApiProperty({ description: 'PR IDs to approve' })
  @IsArray()
  @IsUUID('4', { each: true })
  prIds!: string[];
}

// ── Stock Balance ─────────────────────────────────────────────────────────────

export class UpsertStockDto {
  @ApiProperty()
  @IsUUID()
  itemId!: string;

  @ApiPropertyOptional({ default: 'MAIN' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  location?: string;

  @ApiProperty({ example: 500.5 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  onHand!: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  allocated?: number;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  onOrder?: number;

  @ApiProperty({ example: 'MTR' })
  @IsString()
  @MaxLength(10)
  unit!: string;
}
