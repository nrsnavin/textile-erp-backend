// src/modules/quality/quality.module.ts
import { Module }              from '@nestjs/common';
import { QualityController }   from './quality.controller';
import { QualityService }      from './quality.service';
import { QualityRepository }   from './quality.repository';
import { SharedModule }        from '../../shared/shared.module';

@Module({
  imports:     [SharedModule],
  controllers: [QualityController],
  providers:   [QualityService, QualityRepository],
  exports:     [QualityService],
})
export class QualityModule {}
