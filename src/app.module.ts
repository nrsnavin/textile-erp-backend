// src/app.module.ts
import { Module }       from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule }      from './modules/auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
  ],
})


@Module({
  imports: [
    ThrottlerModule.forRoot([{
      ttl:   60000,  // 1 minute window
      limit: 20,     // 20 requests max
    }]),
    AuthModule,
    // ... your other modules
  ],
})


export class AppModule {}