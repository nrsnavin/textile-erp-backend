import { Module }               from '@nestjs/common';
import { InventoryController }  from './inventory.controller';
import { InventoryService }     from './inventory.service';
import { SharedModule }         from '../../shared/shared.module';

@Module({
  imports:     [SharedModule],
  controllers: [InventoryController],
  providers:   [InventoryService],
  exports:     [InventoryService],
})
export class InventoryModule {}
