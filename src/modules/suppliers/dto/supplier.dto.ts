import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsEmail, IsOptional, IsBoolean,
  IsArray, IsNumber, IsUUID, IsDateString,
  ValidateNested, MinLength, IsEnum, Min,
  Matches, IsUrl,
} from 'class-validator';
import { Type }          from 'class-transformer';
import { PaginationDto } from '../../../shared/utils/pagination.util';

export enum SupplierService {
  FABRIC    = 'FABRIC',
  KNITTING  = 'KNITTING',
  DYEING    = 'DYEING',
  PRINTING  = 'PRINTING',
  SEWING    = 'SEWING',
  PACKING   = 'PACKING',
  EMBROIDERY = 'EMBROIDERY',
}

export enum PaymentTerms {
  NET30     = 'NET30',
  NET60     = 'NET60',
  NET90     = 'NET90',
  IMMEDIATE = 'IMMEDIATE',
  ADVANCE   = 'ADVANCE',
}

export class CreateSupplierDto {
  @ApiProperty() @IsString() @MinLength(2) name!: string;

  @ApiPropertyOptional({ example: '27AAPFU0939F1ZV', description: '15-character GST number' })
  @IsOptional() @IsString()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, {
    message: 'gstin must be a valid 15-character GST number',
  })
  gstin?: string;

  @ApiPropertyOptional() @IsOptional() @IsEmail()  email?:         string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?:         string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?:       string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactPerson?: string;

  @ApiPropertyOptional({ enum: SupplierService, isArray: true })
  @IsOptional() @IsArray() @IsEnum(SupplierService, { each: true })
  services?: SupplierService[];

  // SAP-like vendor master fields
  @ApiPropertyOptional({ example: 'ABCDE1234F', description: '10-character PAN number' })
  @IsOptional() @IsString()
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, { message: 'pan must be a valid 10-character PAN' })
  pan?: string;

  @ApiPropertyOptional({ enum: PaymentTerms, example: 'NET30' })
  @IsOptional() @IsEnum(PaymentTerms)
  paymentTerms?: PaymentTerms;

  @ApiPropertyOptional({ example: 30, description: 'Credit days for invoice payment' })
  @IsOptional() @IsNumber() @Min(0)
  @Type(() => Number)
  creditDays?: number;

  @ApiPropertyOptional({ example: '1234567890', description: 'Bank account number' })
  @IsOptional() @IsString()
  bankAccount?: string;

  @ApiPropertyOptional({ example: 'HDFC0001234', description: 'Bank IFSC code' })
  @IsOptional() @IsString()
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'bankIfsc must be a valid 11-character IFSC code' })
  bankIfsc?: string;

  @ApiPropertyOptional({ example: 'HDFC Bank' })
  @IsOptional() @IsString()
  bankName?: string;

  @ApiPropertyOptional({ example: 'https://supplier.com' })
  @IsOptional() @IsUrl()
  website?: string;
}

export class UpdateSupplierDto {
  @ApiPropertyOptional() @IsOptional() @IsString()  name?:          string;
  @ApiPropertyOptional() @IsOptional() @IsString()  gstin?:         string;
  @ApiPropertyOptional() @IsOptional() @IsEmail()   email?:         string;
  @ApiPropertyOptional() @IsOptional() @IsString()  phone?:         string;
  @ApiPropertyOptional() @IsOptional() @IsString()  address?:       string;
  @ApiPropertyOptional() @IsOptional() @IsString()  contactPerson?: string;

  @ApiPropertyOptional({ enum: SupplierService, isArray: true })
  @IsOptional() @IsArray() @IsEnum(SupplierService, { each: true })
  services?: SupplierService[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString()  pan?:         string;

  @ApiPropertyOptional({ enum: PaymentTerms })
  @IsOptional() @IsEnum(PaymentTerms)
  paymentTerms?: PaymentTerms;

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Type(() => Number)
  creditDays?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() bankAccount?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankIfsc?:    string;
  @ApiPropertyOptional() @IsOptional() @IsString() bankName?:    string;
  @ApiPropertyOptional() @IsOptional() @IsUrl()    website?:     string;
}

export class SupplierFilterDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString()  search?:   string;

  @ApiPropertyOptional({ enum: SupplierService })
  @IsOptional() @IsEnum(SupplierService)
  service?: SupplierService;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiPropertyOptional({ enum: PaymentTerms })
  @IsOptional() @IsEnum(PaymentTerms)
  paymentTerms?: PaymentTerms;
}

export class CreatePoLineDto {
  @ApiProperty() @IsUUID()   itemId!:      string;
  @ApiProperty() @IsNumber() @Min(0.001) qty!:   number;
  @ApiProperty() @IsString() unit!:        string;
  @ApiProperty() @IsNumber() @Min(0) rate!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() hsnCode?:     string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) gstPct?: number;
}

export class UpdatePoLineDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0.001) qty?:  number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0)     rate?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() hsnCode?:     string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0)     gstPct?: number;
}

export class CreatePurchaseOrderDto {
  @ApiProperty() @IsUUID()       supplierId!:   string;
  @ApiProperty() @IsDateString() poDate!:       string;
  @ApiProperty() @IsDateString() expectedDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;

  @ApiProperty({ type: [CreatePoLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePoLineDto)
  lines!: CreatePoLineDto[];
}

export class PoFilterDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID()       supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString()     status?:     string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?:       string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?:         string;
}
