// src/modules/queues/consumers/order.consumer.ts
//
// Kafka consumer: listens to 'order.confirmed' and enqueues an MRP run.
// This wires the flow:  Order confirmed → Kafka → BullMQ → MRP engine.

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectQueue }    from '@nestjs/bull';
import { Queue }          from 'bull';
import { KafkaService }   from '../../../shared/services/kafka.service';
import { Topics, OrderConfirmedEvent } from '../../../shared/contracts/events';
import { MrpJobData }     from '../processors/mrp.processor';

@Injectable()
export class OrderConsumer implements OnModuleInit {
  private readonly logger = new Logger(OrderConsumer.name);

  constructor(
    private readonly kafka: KafkaService,
    @InjectQueue('mrp-queue') private readonly mrpQueue: Queue<MrpJobData>,
  ) {}

  async onModuleInit() {
    // Subscribe to order.confirmed → trigger async MRP run
    await this.kafka.subscribe(
      Topics.ORDER_CONFIRMED,
      'mrp-order-confirmed',
      async (event: unknown) => {
        const data = event as OrderConfirmedEvent;
        this.logger.log(
          `Received order.confirmed: ${data.orderId} (PO ${data.poNumber}) for tenant ${data.tenantId}`,
        );

        await this.mrpQueue.add('run-mrp', {
          tenantId: data.tenantId,
          userId:   data.confirmedBy,
          orderIds: [data.orderId],
        }, {
          priority:  1,                    // high priority
          delay:     2000,                 // 2s debounce — batch nearby confirmations
          jobId:     `mrp-${data.orderId}`, // dedup: one MRP per order
        });

        this.logger.log(`Enqueued MRP run for order ${data.orderId}`);
      },
    );
  }
}
