import { Module }              from '@nestjs/common';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService }    from './suppliers.service';
import { SuppliersRepository } from './suppliers.repository';
import { SharedModule }        from '../../shared/shared.module';

@Module({
  imports:     [SharedModule],
  controllers: [SuppliersController],
  providers:   [SuppliersService, SuppliersRepository],
  exports:     [SuppliersService],
})
export class SuppliersModule {}