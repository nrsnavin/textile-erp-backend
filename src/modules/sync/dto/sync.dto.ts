import {
  IsString, IsNotEmpty, IsArray, ValidateNested,
  IsIn, IsOptional, IsObject, ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MutationDto {
  @IsString()
  @IsNotEmpty()
  clientId!: string; // Client-generated UUID for idempotency

  @IsString()
  @IsNotEmpty()
  endpoint!: string; // e.g. "/api/v1/buyers"

  @IsString()
  @IsIn(['POST', 'PATCH', 'PUT', 'DELETE'])
  method!: string;

  @IsOptional()
  @IsObject()
  body?: Record<string, any>;
}

export class SyncPushDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MutationDto)
  @ArrayMaxSize(100) // Max 100 mutations per batch
  mutations!: MutationDto[];
}

export class SyncAckQueryDto {
  @IsArray()
  @IsString({ each: true })
  clientIds!: string[];
}

export class MutationResultDto {
  clientId!: string;
  status!: 'applied' | 'duplicate' | 'error';
  statusCode!: number;
  responseBody?: any;
  error?: string;
}

export class SyncPushResponseDto {
  results!: MutationResultDto[];
  serverTime!: string;
}
