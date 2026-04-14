// src/modules/production/production.module.ts
import { Module }                from '@nestjs/common';
import { SharedModule }          from '../../shared/shared.module';
import { ProductionController }  from './production.controller';
import { ProductionService }     from './production.service';
import { ProductionRepository }  from './production.repository';

@Module({
  imports:     [SharedModule],
  controllers: [ProductionController],
  providers:   [ProductionService, ProductionRepository],
  exports:     [ProductionService],
})
export class ProductionModule {}
