// src/shared/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public }        from './decorators/public.decorator';
import { HealthService } from './services/health.service';

@ApiTags('Health')
@Controller('api/v1/health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Check service health — database, Redis, Kafka' })
  async check() {
    return this.healthService.check();
  }
}
