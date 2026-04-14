// src/modules/finance/einvoice/einvoice.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsEnum, IsNumber, IsUUID,
  MinLength, MaxLength, IsBoolean, Min,
} from 'class-validator';
import { Type } from 'class-transformer';

// ── Generate IRN request ─────────────────────────────────────────────────────

export class GenerateIrnDto {
  @ApiProperty({ description: 'Invoice ID to generate IRN for' })
  @IsUUID()
  invoiceId!: string;

  @ApiProperty({ example: '29AADCB2230M1ZP', description: 'Seller GSTIN' })
  @IsString()
  @MinLength(15)
  @MaxLength(15)
  sellerGstin!: string;

  @ApiProperty({ example: 'Textile Corp Pvt Ltd' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  sellerLegalName!: string;

  @ApiPropertyOptional({ example: 'Textile Corp' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sellerTradeName?: string;

  @ApiProperty({ example: '123 Industrial Area' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  sellerAddress!: string;

  @ApiProperty({ example: 'Mumbai' })
  @IsString()
  sellerCity!: string;

  @ApiProperty({ example: 400001 })
  @IsNumber()
  @Min(100000)
  @Type(() => Number)
  sellerPin!: number;

  @ApiProperty({ example: '27', description: 'State code (e.g. 27 for Maharashtra)' })
  @IsString()
  @MinLength(1)
  @MaxLength(2)
  sellerStateCode!: string;

  @ApiProperty({ example: '06BZAHM6385P6Z2', description: 'Buyer GSTIN' })
  @IsString()
  @MinLength(15)
  @MaxLength(15)
  buyerGstin!: string;

  @ApiProperty({ example: 'Fashion House LLC' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  buyerLegalName!: string;

  @ApiPropertyOptional({ example: 'Fashion House' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  buyerTradeName?: string;

  @ApiProperty({ example: '456 Market Street' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  buyerAddress!: string;

  @ApiProperty({ example: 'Delhi' })
  @IsString()
  buyerCity!: string;

  @ApiProperty({ example: 110001 })
  @IsNumber()
  @Min(100000)
  @Type(() => Number)
  buyerPin!: number;

  @ApiProperty({ example: '07', description: 'Buyer state code' })
  @IsString()
  @MinLength(1)
  @MaxLength(2)
  buyerStateCode!: string;

  @ApiPropertyOptional({ description: 'Place of supply state code (defaults to buyer state)' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  placeOfSupply?: string;

  @ApiPropertyOptional({ default: false, description: 'true if inter-state supply (IGST)' })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isInterState?: boolean;

  @ApiPropertyOptional({ enum: ['B2B', 'SEZWP', 'SEZWOP', 'EXPWP', 'EXPWOP', 'B2CL'], default: 'B2B' })
  @IsOptional()
  @IsString()
  supplyType?: 'B2B' | 'SEZWP' | 'SEZWOP' | 'EXPWP' | 'EXPWOP' | 'B2CL';
}

// ── Cancel IRN request ───────────────────────────────────────────────────────

export enum CancelReason {
  DUPLICATE         = '1',
  DATA_ENTRY_ERROR  = '2',
  ORDER_CANCELLED   = '3',
  OTHERS            = '4',
}

export class CancelIrnDto {
  @ApiProperty({ description: 'Invoice ID whose IRN should be cancelled' })
  @IsUUID()
  invoiceId!: string;

  @ApiProperty({ enum: CancelReason, example: '2', description: '1=Duplicate, 2=Data entry mistake, 3=Order cancelled, 4=Others' })
  @IsEnum(CancelReason)
  reason!: CancelReason;

  @ApiProperty({ example: 'Incorrect HSN codes on line items' })
  @IsString()
  @MinLength(5)
  @MaxLength(100)
  remark!: string;
}

// ── Get IRN details request ──────────────────────────────────────────────────

export class GetIrnDto {
  @ApiProperty({ description: 'Invoice ID to look up IRN for' })
  @IsUUID()
  invoiceId!: string;
}
