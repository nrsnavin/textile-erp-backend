import { Module }             from '@nestjs/common';
import { ConfigModule }       from '@nestjs/config';
import { ThrottlerModule }    from '@nestjs/throttler';
import { AuthModule }         from './modules/auth/auth.module';
import { BuyersModule }       from './modules/buyer/buyer.module';
import { SuppliersModule }    from './modules/suppliers/suppliers.module';
import { OrdersModule }       from './modules/orders/orders.module';
import { InventoryModule }    from './modules/inventory/inventory.module';
import { SyncModule }         from './modules/sync/sync.module';
import { FinanceModule }      from './modules/finance/finance.module';
import { MrpModule }          from './modules/mrp/mrp.module';
import { ProductionModule }   from './modules/production/production.module';
import { QualityModule }      from './modules/quality/quality.module';
import { QueuesModule }       from './modules/queues/queues.module';
import { HealthController }   from './shared/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 20 }]),
    AuthModule,
    BuyersModule,
    SuppliersModule,
    OrdersModule,
    InventoryModule,
    SyncModule,
    FinanceModule,
    MrpModule,
    ProductionModule,
    QualityModule,
    QueuesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}