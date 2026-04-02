// src/shared/services/redis.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis             from 'ioredis';

// ── RedisService ──────────────────────────────────────────────────────────
// Provides typed cache operations used across all modules.
//
// Cache key convention (always include tenantId for isolation):
//   tenant:{tenantId}:orderbook:summary      → order book KPIs
//   tenant:{tenantId}:stock:{itemId}          → stock balance
//   tenant:{tenantId}:dashboard               → BI dashboard KPIs
//   tenant:{tenantId}:ar:aging                → AR aging report
//   tenant:{tenantId}:mrp:{runId}             → MRP run result
//   tenant:{tenantId}:mes:live:{lineId}       → real-time line efficiency
//   session:{userId}:refresh                  → JWT refresh token

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;

  constructor(private readonly config: ConfigService) {}
async onModuleInit(): Promise<void> {
  const redisUrl = this.config.get<string>(
    'REDIS_URL',
    'redis://127.0.0.1:6379'   // IPv4 default instead of localhost
  );

  this.client = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      if (times > 3) {
        this.logger.warn('Redis unavailable — continuing without cache');
        return null;
      }
      return Math.min(times * 100, 3000);
    },
    lazyConnect:        true,
    enableOfflineQueue: false,
  });

  this.client.on('connect',      () => this.logger.log('Redis connected'));
  this.client.on('error',        (err) => this.logger.error('Redis error', err.message));
  this.client.on('reconnecting', () => this.logger.warn('Redis reconnecting...'));

  try {
    await this.client.connect();
  } catch {
    this.logger.warn('Redis not available — cache disabled');
  }
}
  
  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  // ── Get or set with automatic JSON serialisation ───────────────────────
  // Checks cache first. On miss, calls fetcher(), caches result, returns it.
  // This is the primary method used across all services.
  async getOrSet<T>(
  key:        string,
  ttlSeconds: number,
  fetcher:    () => Promise<T>,
): Promise<T> {
  try {
    const cached = await this.client.get(key);
    if (cached) return JSON.parse(cached) as T;
    const fresh = await fetcher();
    await this.client.setex(key, ttlSeconds, JSON.stringify(fresh));
    return fresh;
  } catch {
    // Redis unavailable — fetch directly
    return fetcher();
  }
}

  // ── Raw get / set ──────────────────────────────────────────────────────
  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    return value ? (JSON.parse(value) as T) : null;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.client.setex(key, ttlSeconds, JSON.stringify(value));
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  // ── Pattern-based invalidation ─────────────────────────────────────────
  // Used by Kafka consumers to invalidate stale cache when data changes.
  // Example: invalidate('tenant:abc:orderbook:*') clears all order cache
  async invalidate(pattern: string): Promise<number> {
    const keys = await this.client.keys(pattern);
    if (!keys.length) return 0;
    await this.client.del(...keys);
    this.logger.debug(`Invalidated ${keys.length} keys matching: ${pattern}`);
    return keys.length;
  }

  // ── Invalidate all cache for a tenant ─────────────────────────────────
  async invalidateTenant(tenantId: string): Promise<void> {
    await this.invalidate(`tenant:${tenantId}:*`);
  }

  // ── Atomic increment (for counters) ───────────────────────────────────
  async increment(key: string, ttlSeconds?: number): Promise<number> {
    const result = await this.client.incr(key);
    if (ttlSeconds && result === 1) {
      await this.client.expire(key, ttlSeconds);
    }
    return result;
  }

  // ── Pub/Sub for WebSocket fanout ───────────────────────────────────────
  async publish(channel: string, message: unknown): Promise<void> {
    await this.client.publish(channel, JSON.stringify(message));
  }

  // ── Health check ──────────────────────────────────────────────────────
  async isHealthy(): Promise<boolean> {
    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  // ── Expose raw client for BullMQ ──────────────────────────────────────
  getClient(): Redis {
    return this.client;
  }
}
