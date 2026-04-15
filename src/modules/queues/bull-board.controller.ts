// src/modules/queues/bull-board.controller.ts
//
// Bull Board dashboard — exposes a UI at /admin/queues for monitoring
// BullMQ jobs (pending, active, completed, failed, delayed).
//
// Protected by JWT + OWNER role so only admins can access.

import { Controller, Get, Req, Res, All } from '@nestjs/common';
import { InjectQueue }       from '@nestjs/bull';
import { Queue }             from 'bull';
import { Request, Response } from 'express';
import { createBullBoard }   from '@bull-board/api';
import { BullAdapter }       from '@bull-board/api/bullAdapter';
import { ExpressAdapter }    from '@bull-board/express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ApiAuth }           from '../../shared/decorators/api-auth.decorator';
import { Role }              from '../../shared/guards/roles.guard';

@ApiTags('Queue Dashboard')
@Controller('admin/queues')
export class BullBoardController {
  private serverAdapter: ExpressAdapter;

  constructor(
    @InjectQueue('mrp-queue')    private readonly mrpQueue:    Queue,
    @InjectQueue('report-queue') private readonly reportQueue: Queue,
    @InjectQueue('email-queue')  private readonly emailQueue:  Queue,
  ) {
    this.serverAdapter = new ExpressAdapter();
    this.serverAdapter.setBasePath('/admin/queues');

    createBullBoard({
      queues: [
        new BullAdapter(this.mrpQueue),
        new BullAdapter(this.reportQueue),
        new BullAdapter(this.emailQueue),
      ],
      serverAdapter: this.serverAdapter,
    });
  }

  @All('*')
  @ApiAuth(Role.OWNER)
  @ApiOperation({ summary: 'Bull Board queue dashboard (owner only)' })
  handleAll(@Req() req: Request, @Res() res: Response) {
    const router = this.serverAdapter.getRouter();
    // Delegate to Bull Board's Express router
    router(req, res);
  }
}
