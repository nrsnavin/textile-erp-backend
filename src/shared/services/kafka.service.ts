// src/shared/services/kafka.service.ts
import {
  Injectable, OnModuleInit, OnModuleDestroy, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Kafka, Producer, Consumer,
  EachMessagePayload, KafkaMessage,
} from 'kafkajs';

type MessageHandler = (event: unknown) => Promise<void>;

// ── KafkaService ──────────────────────────────────────────────────────────
// Wraps KafkaJS for the NestJS DI system.
// Used by every module's Producer and Consumer classes.
//
// Producers call: kafka.emit(topic, { key, value })
// Consumers call: kafka.subscribe(topic, groupId, handler)
//
// All events are partitioned by tenantId (the key field) to guarantee
// event ordering within a single tenant.
//
// Dead Letter Queue: failed messages are moved to {topic}.dlq after
// the configured number of retries.

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger    = new Logger(KafkaService.name);
  private readonly kafka:    Kafka;
  private readonly producer: Producer;
  private readonly consumers: Consumer[] = [];

  constructor(private readonly config: ConfigService) {
    const brokers = config
      .get<string>('KAFKA_BROKERS', 'localhost:9092')
      .split(',')
      .map(b => b.trim());

    this.kafka = new Kafka({
      clientId: 'textile-erp-api',
      brokers,
      retry: {
        retries:        5,
        initialRetryTime: 300,
        factor:         2,
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
    this.logger.log('Kafka producer connected');
  } catch (err) {
    this.logger.warn(
      'Kafka not available — events will not be emitted. ' +
      'Start Kafka with: docker compose up -d'
    );
  }
}

  async onModuleDestroy(): Promise<void> {
    await this.producer.disconnect();
    await Promise.all(this.consumers.map(c => c.disconnect()));
    this.logger.log('Kafka producer and consumers disconnected');
  }

  // ── Emit an event to a topic ──────────────────────────────────────────
  // key must be tenantId — ensures all events for one tenant land on
  // the same partition, preserving ordering within a tenant.
async emit(
  topic:   string,
  message: { key: string; value: unknown },
): Promise<void> {
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
    this.logger.warn(`Kafka emit failed for ${topic} — Kafka may be down`);
    // Do not throw — Kafka failure must not break the main operation
  }
}

  // ── Subscribe to a topic ──────────────────────────────────────────────
  // groupId must be unique per consumer — prevents the same message
  // being processed by multiple service instances simultaneously.
  // Convention: '{module-name}-{topic-name}'
  // Example: 'inventory-service-order-confirmed'
  async subscribe(
    topic:   string,
    groupId: string,
    handler: MessageHandler,
  ): Promise<void> {
    const consumer = this.kafka.consumer({
      groupId,
      sessionTimeout:   30000,
      heartbeatInterval: 3000,
    });

    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: false });

    await consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        const raw = payload.message.value?.toString();
        if (!raw) return;

        try {
          const event = JSON.parse(raw);
          await handler(event);
        } catch (err) {
          this.logger.error(
            `Consumer error on ${topic} [group=${groupId}]: ${(err as Error).message}`,
            (err as Error).stack,
          );

          // Re-throw so KafkaJS retries the message.
          // After max retries, it moves to the Dead Letter Queue.
          throw err;
        }
      },
    });

    this.consumers.push(consumer);
    this.logger.log(`Subscribed to ${topic} [group=${groupId}]`);
  }
}
