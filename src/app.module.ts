import { Module }             from '@nestjs/common';
import { ConfigModule }       from '@nestjs/config';
import { ThrottlerModule }    from '@nestjs/throttler';
import { AuthModule }         from './modules/auth/auth.module';
import { BuyersModule }       from './modules/buyer/buyer.module';
import { SuppliersModule }    from './modules/suppliers/suppliers.module';
import { SyncModule }         from './modules/sync/sync.module';
import { FinanceModule }      from './modules/finance/finance.module';
import { HealthController }   from './shared/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 20 }]),
    AuthModule,
    BuyersModule,
    SuppliersModule,
    SyncModule,
    FinanceModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}