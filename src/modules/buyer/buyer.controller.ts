import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation }    from '@nestjs/swagger';
import { BuyersService }            from './buyer.service';
import { ApiAuth }                  from '../../shared/decorators/api-auth.decorator';
import { CurrentTenant, CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Role }                     from '../../shared/guards/roles.guard';
import { CreateBuyerDto, UpdateBuyerDto, BuyerFilterDto } from './dto/buyer.dto';

@ApiTags('Buyers')
@ApiAuth()
@Controller('api/v1/buyers')
export class BuyersController {
  constructor(private readonly buyersService: BuyersService) {}

  @Get()
  @ApiAuth(Role.OWNER, Role.MERCHANDISER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'List all buyers' })
  async listBuyers(
    @Query() filters: BuyerFilterDto,
    @CurrentTenant() tenantId: string,
  ) {
    return this.buyersService.listBuyers(filters, tenantId);
  }

  @Get(':id')
  @ApiAuth(Role.OWNER, Role.MERCHANDISER, Role.ACCOUNTANT)
  @ApiOperation({ summary: 'Get a single buyer' })
  async getBuyer(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
  ) {
    return this.buyersService.getBuyer(id, tenantId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiAuth(Role.OWNER, Role.MERCHANDISER)
  @ApiOperation({ summary: 'Create a new buyer' })
  async createBuyer(
    @Body() dto: CreateBuyerDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.buyersService.createBuyer(dto, tenantId, userId);
  }

  @Patch(':id')
  @ApiAuth(Role.OWNER, Role.MERCHANDISER)
  @ApiOperation({ summary: 'Update buyer details' })
  async updateBuyer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBuyerDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.buyersService.updateBuyer(id, dto, tenantId, userId);
  }

  @Delete(':id')
  @ApiAuth(Role.OWNER)
  @ApiOperation({ summary: 'Deactivate a buyer' })
  async deleteBuyer(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser()   userId: string,
  ) {
    return this.buyersService.deleteBuyer(id, tenantId, userId);
  }
}