// src/modules/production/dto/production.dto.ts
import {
  IsString, IsInt, IsOptional, IsEnum, IsUUID, IsDateString,
  IsNumber, Min, Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../shared/utils/pagination.util';

// ── Enums ──────────────────────────────────────────────────────────────────

export enum CutOrderStatus {
  PLANNED   = 'PLANNED',
  CUTTING   = 'CUTTING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum LinePlanStatus {
  SCHEDULED = 'SCHEDULED',
  RUNNING   = 'RUNNING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum WipStage {
  CUTTING   = 'CUTTING',
  SEWING    = 'SEWING',
  FINISHING = 'FINISHING',
  PACKING   = 'PACKING',
}

// ── Cut Order DTOs ─────────────────────────────────────────────────────────

export class CreateCutOrderDto {
  @ApiProperty() @IsUUID()
  orderId!: string;

  @ApiProperty() @IsString()
  styleCode!: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  fabricItemId?: string;

  @ApiProperty() @IsInt() @Min(1)
  plannedQty!: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1)
  layers?: number;

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0)
  markerLength?: number;

  @ApiProperty() @IsDateString()
  plannedDate!: string;
}

export class UpdateCutOrderDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0)
  cutQty?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0)
  damagedQty?: number;

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0)
  fabricConsumption?: number;

  @ApiPropertyOptional() @IsOptional() @IsEnum(CutOrderStatus)
  status?: CutOrderStatus;
}

export class CutOrderFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: CutOrderStatus })
  @IsOptional() @IsEnum(CutOrderStatus)
  status?: CutOrderStatus;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  orderId?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  from?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  to?: string;
}

// ── Line Plan DTOs ─────────────────────────────────────────────────────────

export class CreateLinePlanDto {
  @ApiProperty() @IsUUID()
  orderId!: string;

  @ApiProperty() @IsString()
  lineNumber!: string;

  @ApiProperty() @IsString()
  styleCode!: string;

  @ApiProperty() @IsInt() @Min(1)
  targetQty!: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0)
  operatorCount?: number;

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0)
  sam?: number;

  @ApiProperty() @IsDateString()
  planDate!: string;

  @ApiPropertyOptional({ enum: ['DAY', 'NIGHT'] })
  @IsOptional() @IsString()
  shift?: string;
}

export class UpdateLinePlanDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0)
  achievedQty?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0)
  rejectQty?: number;

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(200)
  efficiency?: number;

  @ApiPropertyOptional() @IsOptional() @IsEnum(LinePlanStatus)
  status?: LinePlanStatus;
}

export class LinePlanFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: LinePlanStatus })
  @IsOptional() @IsEnum(LinePlanStatus)
  status?: LinePlanStatus;

  @ApiPropertyOptional() @IsOptional() @IsString()
  lineNumber?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  orderId?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  from?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  to?: string;
}

// ── WIP Record DTOs ────────────────────────────────────────────────────────

export class CreateWipRecordDto {
  @ApiProperty() @IsUUID()
  orderId!: string;

  @ApiProperty() @IsString()
  styleCode!: string;

  @ApiProperty({ enum: WipStage }) @IsEnum(WipStage)
  stage!: WipStage;

  @ApiProperty() @IsInt() @Min(0)
  inputQty!: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0)
  outputQty?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0)
  rejectQty?: number;

  @ApiProperty() @IsDateString()
  recordDate!: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  remarks?: string;
}

export class UpdateWipRecordDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0)
  outputQty?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0)
  rejectQty?: number;

  @ApiPropertyOptional() @IsOptional() @IsString()
  remarks?: string;
}

export class WipFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: WipStage })
  @IsOptional() @IsEnum(WipStage)
  stage?: WipStage;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  orderId?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  from?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  to?: string;
}
