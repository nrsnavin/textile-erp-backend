// src/shared/health.controller.ts
import { Controller, Get } from '@nestjs/common';

@Controller('api/v1/health')
export class HealthController {

  @Get()
  check() {
    return {
      status:    'ok',
      timestamp: new Date().toISOString(),
      uptime:    Math.floor(process.uptime()),
    };
  }
}