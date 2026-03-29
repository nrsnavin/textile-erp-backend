// src/shared/shared.module.ts
import { Global, Module }  from '@nestjs/common';
import { HttpModule }      from '@nestjs/axios';
import { ConfigModule }    from '@nestjs/config';

import { PrismaModule }    from './prisma/prisma.module';
import { PrismaService }   from './prisma/prisma.service';

import { RedisService }    from './services/redis.service';
import { KafkaService }    from './services/kafka.service';
import { AuditService }    from './services/audit.service';
import { S3Service }       from './services/s3.service';
import { EmailService }    from './services/email.service';
import { WhatsAppService } from './services/whatsapp.service';
import { HealthService }   from './services/health.service';

// ── SharedModule ───────────────────────────────────────────────────────────
// @Global() means every module in the app can inject these services
// without importing SharedModule — just declare it once in AppModule.
//
// In AppModule:
//   imports: [SharedModule, OrdersModule, InventoryModule, ...]

@Global()
@Module({
  imports: [
    PrismaModule,
    HttpModule,
    ConfigModule,
  ],
  providers: [
    PrismaService,
    RedisService,
    KafkaService,
    AuditService,
    S3Service,
    EmailService,
    WhatsAppService,
    HealthService,
  ],
  exports: [
    PrismaService,
    RedisService,
    KafkaService,
    AuditService,
    S3Service,
    EmailService,
    WhatsAppService,
    HealthService,
  ],
})
export class SharedModule {}
