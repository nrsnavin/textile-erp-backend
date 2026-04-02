import { Module }          from '@nestjs/common';
import { BuyersController } from './buyer.controller';
import { BuyersService }    from './buyer.service';
import { BuyersRepository } from './buyer.repositery';
import { SharedModule }     from '../../shared/shared.module';

@Module({
  imports:     [SharedModule],
  controllers: [BuyersController],
  providers:   [BuyersService, BuyersRepository],
  exports:     [BuyersService],
})
export class BuyersModule {}