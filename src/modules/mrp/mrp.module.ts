// src/modules/mrp/mrp.module.ts
import { Module }         from '@nestjs/common';
import { SharedModule }   from '../../shared/shared.module';
import { MrpController }  from './mrp.controller';
import { MrpService }     from './mrp.service';
import { MrpRepository }  from './mrp.repository';

@Module({
  imports:     [SharedModule],
  controllers: [MrpController],
  providers:   [MrpService, MrpRepository],
  exports:     [MrpService],
})
export class MrpModule {}
