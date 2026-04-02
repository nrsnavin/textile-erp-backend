// src/shared/services/audit.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Prisma }             from '@prisma/client';
import { PrismaService }      from '../prisma/prisma.service';

export type AuditAction =
  | 'CREATE' | 'UPDATE' | 'DELETE'
  | 'CONFIRM_ORDER' | 'CANCEL_ORDER' | 'REVISE_ORDER'
  | 'POST_GRN' | 'ISSUE_STOCK'
  | 'CONFIRM_PAYMENT' | 'GENERATE_EINVOICE'
  | 'PASS_QC' | 'FAIL_QC' | 'RAISE_NCR'
  | 'DISPATCH_SHIPMENT'
  | 'LOGIN' | 'LOGOUT' | 'PASSWORD_RESET' | 'ROLE_CHANGE'
  | string;

export interface AuditParams {
  tenantId:   string;
  userId:     string;
  action:     AuditAction;
  tableName:  string;
  recordId:   string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(params: AuditParams): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId:  params.tenantId,
          userId:    params.userId,
          action:    params.action,
          tableName: params.tableName,
          recordId:  params.recordId,
          oldValues: params.oldValues
            ? (params.oldValues as Prisma.InputJsonValue)
            : undefined,
          newValues: params.newValues
            ? (params.newValues as Prisma.InputJsonValue)
            : undefined,
          ipAddress: params.ipAddress,
        },
      });
    } catch (err) {
      // Never let audit logging break the main operation
      this.logger.error(
        `Failed to write audit log: ${params.action} on ` +
        `${params.tableName}/${params.recordId}`,
        err,
      );
    }
  }

  async getHistory(
    tenantId:  string,
    tableName: string,
    recordId:  string,
    limit:     number = 50,
  ) {
    return this.prisma.auditLog.findMany({
      where:   { tenantId, tableName, recordId },
      orderBy: { createdAt: 'desc' },
      take:    limit,
    });
  }

  async getUserActivity(
    tenantId: string,
    userId:   string,
    limit:    number = 100,
  ) {
    return this.prisma.auditLog.findMany({
      where:   { tenantId, userId },
      orderBy: { createdAt: 'desc' },
      take:    limit,
    });
  }
}