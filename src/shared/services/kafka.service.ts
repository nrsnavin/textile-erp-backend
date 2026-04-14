// src/shared/services/kafka.service.ts
import {
  Injectable, OnModuleInit, OnModuleDestroy, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Kafka, Producer, Consumer,
  EachMessagePayload,
} from 'kafkajs';

type MessageHandler = (event: unknown) => Promise<void>;

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger    = new Logger(KafkaService.name);
  private readonly kafka:    Kafka;
  private readonly producer: Producer;
  private readonly consumers: Consumer[] = [];
  private producerConnected  = false;   // guard: emit() and disconnect() check this

  constructor(private readonly config: ConfigService) {
    const brokers = config
      .get<string>('KAFKA_BROKERS', 'localhost:9092')
      .split(',')
      .map(b => b.trim());

    this.kafka = new Kafka({
      clientId: 'textile-erp-api',
      brokers,
      // Suppress KafkaJS's own retry noise — we handle connection failure ourselves
      logLevel: 1,   // ERROR only (0=NOTHING, 1=ERROR, 2=WARN, 4=INFO, 5=DEBUG)
      retry: {
        retries:          3,
        initialRetryTime: 300,
        factor:           2,
      },
    });

    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout:     30000,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.producer.connect();
      this.producerConnected = true;
      this.logger.log('Kafka producer connected');
    } catch {
      this.logger.warn(
        'Kafka not available — events will not be emitted. ' +
        'Start Kafka with: docker compose up -d kafka',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Only disconnect what was actually connected
    if (this.producerConnected) {
      await this.producer.disconnect().catch(() => {});
    }
    await Promise.all(
      this.consumers.map(c => c.disconnect().catch(() => {})),
    );
  }

  // ── Emit an event to a topic ────────────────────────────────────────────
  // key = tenantId — guarantees ordering within a tenant (same partition).
  // Never throws: Kafka failure must not break the main HTTP operation.
  async emit(
    topic:   string,
    message: { key: string; value: unknown },
  ): Promise<void> {
    if (!this.producerConnected) return;   // silently skip when Kafka is down
    try {
      await this.producer.send({
        topic,
        messages: [{
          key:   message.key,
          value: JSON.stringify(message.value),
        }],
      });
      this.logger.debug(`Emitted → ${topic} [key=${message.key}]`);
    } catch (err) {
      this.logger.warn(`Kafka emit failed for ${topic}: ${(err as Error).message}`);
    }
  }

  // ── Subscribe to a topic ────────────────────────────────────────────────
  // groupId convention: '{module}-{topic}', e.g. 'inventory-order-confirmed'
  // No-ops when Kafka is unavailable — subscriptions simply won't activate.
  async subscribe(
    topic:   string,
    groupId: string,
    handler: MessageHandler,
  ): Promise<void> {
    if (!this.producerConnected) {
      this.logger.warn(`Skipping subscription to ${topic} — Kafka unavailable`);
      return;
    }

    try {
      const consumer = this.kafka.consumer({
        groupId,
        sessionTimeout:    30000,
        heartbeatInterval: 3000,
      });

      await consumer.connect();
      await consumer.subscribe({ topic, fromBeginning: false });

      await consumer.run({
        eachMessage: async (payload: EachMessagePayload) => {
          const raw = payload.message.value?.toString();
          if (!raw) return;
          try {
            await handler(JSON.parse(raw));
          } catch (err) {
            this.logger.error(
              `Consumer error on ${topic} [group=${groupId}]: ${(err as Error).message}`,
              (err as Error).stack,
            );
            throw err;   // re-throw so KafkaJS retries → DLQ after max retries
          }
        },
      });

      this.consumers.push(consumer);
      this.logger.log(`Subscribed to ${topic} [group=${groupId}]`);
    } catch (err) {
      this.logger.warn(
        `Failed to subscribe to ${topic}: ${(err as Error).message}`,
      );
    }
  }

  // ── Health check ────────────────────────────────────────────────────────
  isAvailable(): boolean {
    return this.producerConnected;
  }
}
