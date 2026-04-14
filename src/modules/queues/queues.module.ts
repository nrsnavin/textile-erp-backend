// src/modules/queues/queues.module.ts
//
// Centralised BullMQ queue registration + Bull Board dashboard.
//
// Queues:
//   mrp-queue     — Async MRP runs triggered by order.confirmed
//   report-queue  — PDF/Excel report generation
//   email-queue   — Transactional emails (invoice, PO, alerts)

import { Module }          from '@nestjs/common';
import { BullModule }      from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SharedModule }    from '../../shared/shared.module';
import { MrpModule }       from '../mrp/mrp.module';

import { MrpProcessor }    from './processors/mrp.processor';
import { ReportProcessor } from './processors/report.processor';
import { EmailProcessor }  from './processors/email.processor';
import { OrderConsumer }   from './consumers/order.consumer';
import { BullBoardController } from './bull-board.controller';

@Module({
  imports: [
    SharedModule,
    MrpModule,
    // Register Bull with Redis connection
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get('REDIS_PASSWORD', undefined),
        },
        defaultJobOptions: {
          removeOnComplete: 100,  // keep last 100 completed
          removeOnFail:     200,  // keep last 200 failed for debugging
          attempts:         3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      }),
      inject: [ConfigService],
    }),
    // Register individual queues
    BullModule.registerQueue(
      { name: 'mrp-queue' },
      { name: 'report-queue' },
      { name: 'email-queue' },
    ),
  ],
  controllers: [BullBoardController],
  providers: [
    MrpProcessor,
    ReportProcessor,
    EmailProcessor,
    OrderConsumer,
  ],
})
export class QueuesModule {}
