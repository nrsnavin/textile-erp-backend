import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsEmail, IsOptional,
  IsBoolean, MinLength, MaxLength,
  IsEnum, IsNumber, Min, IsUrl,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../../shared/utils/pagination.util';

export enum PaymentTerms {
  NET30     = 'NET30',
  NET60     = 'NET60',
  NET90     = 'NET90',
  IMMEDIATE = 'IMMEDIATE',
  ADVANCE   = 'ADVANCE',
}

export enum BuyerSegment {
  A = 'A',  // High value / strategic
  B = 'B',  // Medium value
  C = 'C',  // Low value
}

export class CreateBuyerDto {
  @ApiProperty({ example: 'Acme Fashion GmbH' })
  @IsString() @MinLength(2) @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'DE' })
  @IsString() @MaxLength(2)
  country!: string;

  @ApiPropertyOptional() @IsOptional() @IsEmail()   email?:    string;
  @ApiPropertyOptional() @IsOptional() @IsString()  phone?:    string;
  @ApiPropertyOptional() @IsOptional() @IsString()  currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString()  address?:  string;

  // SAP-like customer master fields
  @ApiPropertyOptional({ enum: PaymentTerms, example: 'NET30' })
  @IsOptional() @IsEnum(PaymentTerms)
  paymentTerms?: PaymentTerms;

  @ApiPropertyOptional({ example: 50000, description: 'Credit limit in buyer currency' })
  @IsOptional() @IsNumber() @Min(0)
  @Type(() => Number)
  creditLimit?: number;

  @ApiPropertyOptional({ example: 30, description: 'Credit days allowed' })
  @IsOptional() @IsNumber() @Min(0)
  @Type(() => Number)
  creditDays?: number;

  @ApiPropertyOptional({ example: 'DE123456789', description: 'VAT / GST registration number' })
  @IsOptional() @IsString()
  taxId?: string;

  @ApiPropertyOptional({ enum: BuyerSegment, description: 'ABC classification' })
  @IsOptional() @IsEnum(BuyerSegment)
  segment?: BuyerSegment;

  @ApiPropertyOptional({ example: 'https://acmefashion.de' })
  @IsOptional() @IsUrl()
  website?: string;
}

export class UpdateBuyerDto {
  @ApiPropertyOptional() @IsOptional() @IsString()  name?:     string;
  @ApiPropertyOptional() @IsOptional() @IsString()  country?:  string;
  @ApiPropertyOptional() @IsOptional() @IsEmail()   email?:    string;
  @ApiPropertyOptional() @IsOptional() @IsString()  phone?:    string;
  @ApiPropertyOptional() @IsOptional() @IsString()  currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString()  address?:  string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiPropertyOptional({ enum: PaymentTerms })
  @IsOptional() @IsEnum(PaymentTerms)
  paymentTerms?: PaymentTerms;

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Type(() => Number)
  creditLimit?: number;

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Type(() => Number)
  creditDays?: number;

  @ApiPropertyOptional() @IsOptional() @IsString()
  taxId?: string;

  @ApiPropertyOptional({ enum: BuyerSegment })
  @IsOptional() @IsEnum(BuyerSegment)
  segment?: BuyerSegment;

  @ApiPropertyOptional() @IsOptional() @IsUrl()
  website?: string;
}

export class BuyerFilterDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString()  search?:   string;
  @ApiPropertyOptional() @IsOptional() @IsString()  country?:  string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiPropertyOptional({ enum: PaymentTerms })
  @IsOptional() @IsEnum(PaymentTerms)
  paymentTerms?: PaymentTerms;

  @ApiPropertyOptional({ enum: BuyerSegment })
  @IsOptional() @IsEnum(BuyerSegment)
  segment?: BuyerSegment;
}
