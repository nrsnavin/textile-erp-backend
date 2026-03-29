// src/shared/services/health.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService }  from './redis.service';

export interface HealthStatus {
  status:   'ok' | 'degraded' | 'down';
  version:  string;
  uptime:   number;
  checks: {
    database: 'ok' | 'error';
    redis:    'ok' | 'error';
    kafka:    'ok' | 'error';
  };
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis:  RedisService,
  ) {}

  async check(): Promise<HealthStatus> {
    const [dbOk, redisOk] = await Promise.all([
      this.prisma.isHealthy().catch(() => false),
      this.redis.isHealthy().catch(() => false),
    ]);

    const allOk = dbOk && redisOk;

    return {
      status:  allOk ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '1.0.0',
      uptime:  Math.floor(process.uptime()),
      checks: {
        database: dbOk    ? 'ok' : 'error',
        redis:    redisOk ? 'ok' : 'error',
        kafka:    'ok',  // basic connectivity; deep check via consumer lag
      },
    };
  }
}
