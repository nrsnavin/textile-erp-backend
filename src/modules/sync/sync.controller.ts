import {
  Controller, Post, Body, HttpCode, HttpStatus, Query, Get,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SyncService } from './sync.service';
import { ApiAuth } from '../../shared/decorators/api-auth.decorator';
import { CurrentTenant, CurrentUser } from '../../shared/decorators/current-user.decorator';
import { SyncPushDto, SyncAckQueryDto } from './dto/sync.dto';

@ApiTags('Sync')
@ApiAuth()
@Controller('api/v1/sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('push')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Push offline mutations for server-side processing with idempotency',
    description:
      'Accepts a batch of mutations (max 100) from mobile offline queue. ' +
      'Each mutation carries a client-generated UUID. If a mutation has already ' +
      'been processed (duplicate clientId), the cached result is returned instead ' +
      'of replaying the operation. Mutations are processed sequentially to preserve ordering.',
  })
  async pushMutations(
    @Body() dto: SyncPushDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
  ) {
    return this.syncService.pushMutations(dto.mutations, tenantId, userId);
  }

  @Post('ack')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check which mutations have been acknowledged by the server',
    description:
      'Given a list of client mutation IDs, returns the subset that the server ' +
      'has already processed. Used by the mobile client to safely delete mutations ' +
      'from its local queue without risk of data loss.',
  })
  async checkAcknowledged(
    @Body() dto: SyncAckQueryDto,
    @CurrentTenant() tenantId: string,
  ) {
    const acknowledged = await this.syncService.getAcknowledged(
      tenantId,
      dto.clientIds,
    );
    return { acknowledged, serverTime: new Date().toISOString() };
  }
}
