// src/modules/finance/finance.module.ts
import { Module }              from '@nestjs/common';
import { HttpModule }          from '@nestjs/axios';
import { SharedModule }        from '../../shared/shared.module';
import { FinanceController }   from './finance.controller';
import { FinanceService }      from './finance.service';
import { FinanceRepository }   from './finance.repository';
import { GstService }          from './gst/gst.service';
import { EInvoiceService }     from './einvoice/einvoice.service';

@Module({
  imports:     [SharedModule, HttpModule],
  controllers: [FinanceController],
  providers:   [FinanceService, FinanceRepository, GstService, EInvoiceService],
  exports:     [FinanceService, GstService, EInvoiceService],
})
export class FinanceModule {}
