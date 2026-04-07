import { Module }             from '@nestjs/common';
import { ConfigModule }       from '@nestjs/config';
import { ThrottlerModule }    from '@nestjs/throttler';
import { AuthModule }         from './modules/auth/auth.module';
import { BuyersModule }       from './modules/buyer/buyer.module';
import { SuppliersModule }    from './modules/suppliers/suppliers.module';
import { OrdersModule }       from './modules/orders/orders.module';
import { InventoryModule }    from './modules/inventory/inventory.module';
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
  ],
  controllers: [HealthController],
})
export class AppModule {}