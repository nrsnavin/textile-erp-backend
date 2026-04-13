// src/modules/finance/finance.module.ts
import { Module }              from '@nestjs/common';
import { SharedModule }        from '../../shared/shared.module';
import { FinanceController }   from './finance.controller';
import { FinanceService }      from './finance.service';
import { FinanceRepository }   from './finance.repository';
import { GstService }          from './gst/gst.service';

@Module({
  imports:     [SharedModule],
  controllers: [FinanceController],
  providers:   [FinanceService, FinanceRepository, GstService],
  exports:     [FinanceService, GstService],
})
export class FinanceModule {}
