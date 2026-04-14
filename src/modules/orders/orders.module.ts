import { Module }            from '@nestjs/common';
import { OrdersController }  from './orders.controller';
import { OrdersService }     from './orders.service';
import { SharedModule }      from '../../shared/shared.module';

// SharedModule exports KafkaService, PrismaService, AuditService — no extra imports needed.

@Module({
  imports:     [SharedModule],
  controllers: [OrdersController],
  providers:   [OrdersService],
  exports:     [OrdersService],
})
export class OrdersModule {}
