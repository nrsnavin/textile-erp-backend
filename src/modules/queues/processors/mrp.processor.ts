// src/modules/queues/processors/mrp.processor.ts
import { Process, Processor }   from '@nestjs/bull';
import { Logger }               from '@nestjs/common';
import { Job }                  from 'bull';
import { MrpService }           from '../../mrp/mrp.service';
import { KafkaService }         from '../../../shared/services/kafka.service';
import { Topics }               from '../../../shared/contracts/events';

export interface MrpJobData {
  tenantId:  string;
  userId:    string;
  orderIds?: string[];
  maxDepth?: number;
}

@Processor('mrp-queue')
export class MrpProcessor {
  private readonly logger = new Logger(MrpProcessor.name);

  constructor(
    private readonly mrpService: MrpService,
    private readonly kafka:      KafkaService,
  ) {}

  @Process('run-mrp')
  async handleMrpRun(job: Job<MrpJobData>) {
    const { tenantId, userId, orderIds, maxDepth } = job.data;
    this.logger.log(`[Job ${job.id}] Starting MRP run for tenant ${tenantId}`);

    try {
      const result = await this.mrpService.runMrp(
        { orderIds, maxDepth },
        tenantId,
        userId,
      );

      this.logger.log(
        `[Job ${job.id}] MRP completed — ` +
        `${result?.lineCount ?? 0} lines, ${result?.requisitionCount ?? 0} PRs`,
      );

      await this.kafka.emit(Topics.MRP_RUN_COMPLETED, {
        key: tenantId,
        value: {
          tenantId,
          timestamp:        new Date().toISOString(),
          mrpRunId:         result?.id,
          orderCount:       result?.orderCount ?? 0,
          lineCount:        result?.lineCount ?? 0,
          requisitionCount: result?.requisitionCount ?? 0,
          durationMs:       result?.durationMs ?? 0,
        },
      });

      return result;
    } catch (error: any) {
      this.logger.error(`[Job ${job.id}] MRP failed: ${error.message}`, error.stack);
      throw error;
    }
  }
}
