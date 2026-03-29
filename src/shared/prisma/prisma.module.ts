// src/shared/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService }  from './prisma.service';

// @Global() makes PrismaService available in every module
// without needing to import PrismaModule in each one.
// Only the root AppModule needs to import PrismaModule.

@Global()
@Module({
  providers: [PrismaService],
  exports:   [PrismaService],
})
export class PrismaModule {}
