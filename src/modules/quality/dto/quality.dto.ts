// src/modules/quality/dto/quality.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsUUID, IsInt,
  IsIn, Min, IsArray, IsNumber,
} from 'class-validator';
import { PaginationDto } from '../../../shared/utils/pagination.util';

const INSP_TYPES  = ['INLINE', 'ENDLINE', 'FINAL', 'PRE_SHIPMENT'] as const;
const RESULTS     = ['PASS', 'FAIL', 'CONDITIONAL'] as const;
const AQL_LEVELS  = ['1.0', '1.5', '2.5', '4.0', '6.5'] as const;

// ── CreateQcInspectionDto ────────────────────────────────────────────────────

export class CreateQcInspectionDto {
  @ApiProperty({ description: 'Order UUID being inspected' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ description: 'Style code under inspection', example: 'SS24-TEE-001' })
  @IsString()
  styleCode!: string;

  @ApiProperty({ description: 'Inspection type', enum: INSP_TYPES })
  @IsIn(INSP_TYPES)
  inspType!: string;

  @ApiProperty({ description: 'Inspection result', enum: RESULTS })
  @IsIn(RESULTS)
  result!: string;

  @ApiPropertyOptional({ description: 'AQL acceptance level', enum: AQL_LEVELS })
  @IsOptional()
  @IsString()
  aqlLevel?: string;

  @ApiPropertyOptional({ description: 'Number of pieces sampled', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  sampleSize?: number;

  @ApiProperty({ description: 'Number of defects found', minimum: 0, default: 0 })
  @IsInt()
  @Min(0)
  defectCount!: number;

  @ApiPropertyOptional({ description: 'Photo URLs (uploaded to S3)', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoUrls?: string[];

  @ApiPropertyOptional({ description: 'Inspector notes / observations' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── UpdateQcInspectionDto ────────────────────────────────────────────────────

export class UpdateQcInspectionDto {
  @ApiPropertyOptional({ description: 'Updated result', enum: RESULTS })
  @IsOptional()
  @IsIn(RESULTS)
  result?: string;

  @ApiPropertyOptional({ description: 'Updated defect count', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  defectCount?: number;

  @ApiPropertyOptional({ description: 'Updated photo URLs', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoUrls?: string[];

  @ApiPropertyOptional({ description: 'Updated notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── QcFilterDto ──────────────────────────────────────────────────────────────

export class QcFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by order UUID' })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({ description: 'Filter by style code' })
  @IsOptional()
  @IsString()
  styleCode?: string;

  @ApiPropertyOptional({ description: 'Filter by inspection type', enum: INSP_TYPES })
  @IsOptional()
  @IsIn(INSP_TYPES)
  inspType?: string;

  @ApiPropertyOptional({ description: 'Filter by result', enum: RESULTS })
  @IsOptional()
  @IsIn(RESULTS)
  result?: string;
}

// ── QcSummaryDto (return type) ───────────────────────────────────────────────

export class QcDashboardSummary {
  @ApiProperty() totalInspections!: number;
  @ApiProperty() passCount!: number;
  @ApiProperty() failCount!: number;
  @ApiProperty() conditionalCount!: number;
  @ApiProperty() passRate!: number;
  @ApiProperty() avgDefects!: number;
}
