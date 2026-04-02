import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsEmail, IsOptional, IsBoolean,
  IsArray, IsNumber, IsUUID, IsDateString,
  ValidateNested, MinLength,
} from 'class-validator';
import { Type }          from 'class-transformer';
import { PaginationDto } from '../../../shared/utils/pagination.util';

export class CreateSupplierDto {
  @ApiProperty() @IsString() @MinLength(2) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() gstin?:         string;
  @ApiPropertyOptional() @IsOptional() @IsEmail()  email?:         string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?:         string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?:       string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactPerson?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray()  @IsString({ each: true })
  services?: string[];
}

export class UpdateSupplierDto {
  @ApiPropertyOptional() @IsOptional() @IsString()  name?:          string;
  @ApiPropertyOptional() @IsOptional() @IsString()  gstin?:         string;
  @ApiPropertyOptional() @IsOptional() @IsEmail()   email?:         string;
  @ApiPropertyOptional() @IsOptional() @IsString()  phone?:         string;
  @ApiPropertyOptional() @IsOptional() @IsString()  address?:       string;
  @ApiPropertyOptional() @IsOptional() @IsString()  contactPerson?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray()   services?:      string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?:      boolean;
}

export class SupplierFilterDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString()  search?:   string;
  @ApiPropertyOptional() @IsOptional() @IsString()  service?:  string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreatePoLineDto {
  @ApiProperty() @IsUUID()   itemId!:      string;
  @ApiProperty() @IsNumber() qty!:         number;
  @ApiProperty() @IsString() unit!:        string;
  @ApiProperty() @IsNumber() rate!:        number;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() hsnCode?:     string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() gstPct?:      number;
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