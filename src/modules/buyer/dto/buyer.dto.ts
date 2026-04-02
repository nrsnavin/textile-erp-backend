import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsEmail, IsOptional,
  IsBoolean, MinLength, MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../../shared/utils/pagination.util';

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
}

export class UpdateBuyerDto {
  @ApiPropertyOptional() @IsOptional() @IsString()  name?:     string;
  @ApiPropertyOptional() @IsOptional() @IsString()  country?:  string;
  @ApiPropertyOptional() @IsOptional() @IsEmail()   email?:    string;
  @ApiPropertyOptional() @IsOptional() @IsString()  phone?:    string;
  @ApiPropertyOptional() @IsOptional() @IsString()  currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString()  address?:  string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class BuyerFilterDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString()  search?:   string;
  @ApiPropertyOptional() @IsOptional() @IsString()  country?:  string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}