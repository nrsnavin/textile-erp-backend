// src/shared/services/redis.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis             from 'ioredis';

// ── RedisService ──────────────────────────────────────────────────────────
// All public methods are safe to call even when Redis is unavailable.
// Each method falls back gracefully:
//   get()       → null
//   set/del()   → no-op
//   getOrSet()  → calls fetcher() directly
//   invalidate()→ returns 0
//   increment() → returns 0
//   publish()   → no-op
//
// Cache key convention (always includes tenantId):
//   tenant:{tenantId}:orderbook:summary
//   tenant:{tenantId}:stock:{itemId}
//   tenant:{tenantId}:dashboard
//   tenant:{tenantId}:ar:aging
//   session:{userId}:refresh

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;
  private connected = false;   // guard: all ops check this before touching client

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL', 'redis://127.0.0.1:6379');

    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => {
        if (times > 3) return null;    // stop retrying after 3 attempts
        return Math.min(times * 200, 2000);
      },
      lazyConnect:         true,
      enableOfflineQueue:  false,      // don't queue commands when disconnected
      connectTimeout:      5000,
    });

    this.client.on('connect',      () => {
      this.connected = true;
      this.logger.log('Redis connected');
    });
    this.client.on('close',        () => {
      this.connected = false;
    });
    this.client.on('error',        (err) => {
      this.logger.error(`Redis error\n${err.message}`);
    });
    this.client.on('reconnecting', () => this.logger.warn('Redis reconnecting...'));

    try {
      await this.client.connect();
    } catch {
      this.logger.warn('Redis unavailable — cache and pub/sub disabled');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connected) {
      await this.client.quit().catch(() => {});
    }
  }

  // ── Get or set (primary cache pattern) ────────────────────────────────
  async getOrSet<T>(
    key:        string,
    ttlSeconds: number,
    fetcher:    () => Promise<T>,
  ): Promise<T> {
    if (!this.connected) return fetcher();
    try {
      const cached = await this.client.get(key);
      if (cached) return JSON.parse(cached) as T;
      const fresh = await fetcher();
      await this.client.setex(key, ttlSeconds, JSON.stringify(fresh));
      return fresh;
    } catch {
      return fetcher();
    }
  }

  // ── Raw get ────────────────────────────────────────────────────────────
  async get<T>(key: string): Promise<T | null> {
    if (!this.connected) return null;
    try {
      const value = await this.client.get(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch {
      return null;
    }
  }

  // ── Raw set ────────────────────────────────────────────────────────────
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (!this.connected) return;
    try {
      await this.client.setex(key, ttlSeconds, JSON.stringify(value));
    } catch { /* no-op */ }
  }

  // ── Delete ─────────────────────────────────────────────────────────────
  async del(key: string): Promise<void> {
    if (!this.connected) return;
    try {
      await this.client.del(key);
    } catch { /* no-op */ }
  }

  // ── Pattern-based invalidation ─────────────────────────────────────────
  async invalidate(pattern: string): Promise<number> {
    if (!this.connected) return 0;
    try {
      const keys = await this.client.keys(pattern);
      if (!keys.length) return 0;
      await this.client.del(...keys);
      this.logger.debug(`Invalidated ${keys.length} keys matching: ${pattern}`);
      return keys.length;
    } catch {
      return 0;
    }
  }

  // ── Invalidate all cache for a tenant ─────────────────────────────────
  async invalidateTenant(tenantId: string): Promise<void> {
    await this.invalidate(`tenant:${tenantId}:*`);
  }

  // ── Atomic increment ───────────────────────────────────────────────────
  async increment(key: string, ttlSeconds?: number): Promise<number> {
    if (!this.connected) return 0;
    try {
      const result = await this.client.incr(key);
      if (ttlSeconds && result === 1) await this.client.expire(key, ttlSeconds);
      return result;
    } catch {
      return 0;
    }
  }

  // ── Pub/Sub for WebSocket fanout ───────────────────────────────────────
  async publish(channel: string, message: unknown): Promise<void> {
    if (!this.connected) return;
    try {
      await this.client.publish(channel, JSON.stringify(message));
    } catch { /* no-op */ }
  }

  // ── Health check ──────────────────────────────────────────────────────
  async isHealthy(): Promise<boolean> {
    if (!this.connected) return false;
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  // ── Expose raw client for BullMQ ──────────────────────────────────────
  getClient(): Redis {
    return this.client;
  }

  isAvailable(): boolean {
    return this.connected;
  }
}
