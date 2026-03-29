// src/shared/services/audit.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService }      from '../prisma/prisma.service';

// ── AuditService ──────────────────────────────────────────────────────────
// Every data mutation must be logged here.
// The audit_log table is immutable — no UPDATE or DELETE ever runs on it.
// Retention: 7 years (regulatory requirement for financial records).
//
// Call this from every service method that creates, updates, or deletes data.
//
// Usage:
//   await this.auditService.log({
//     tenantId:  tenantId,
//     userId:    userId,
//     action:    'CONFIRM_ORDER',
//     tableName: 'orders',
//     recordId:  orderId,
//     oldValues: { status: 'DRAFT' },
//     newValues: { status: 'CONFIRMED' },
//     ipAddress: request.ip,
//   });

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'CONFIRM_ORDER'
  | 'CANCEL_ORDER'
  | 'REVISE_ORDER'
  | 'POST_GRN'
  | 'ISSUE_STOCK'
  | 'CONFIRM_PAYMENT'
  | 'GENERATE_EINVOICE'
  | 'PASS_QC'
  | 'FAIL_QC'
  | 'RAISE_NCR'
  | 'DISPATCH_SHIPMENT'
  | 'LOGIN'
  | 'LOGOUT'
  | 'PASSWORD_RESET'
  | 'ROLE_CHANGE'
  | string; // extensible

export interface AuditParams {
  tenantId:   string;
  userId:     string;
  action:     AuditAction;
  tableName:  string;
  recordId:   string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  ipAddress?: string;
  metadata?:  Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Log a single mutation ─────────────────────────────────────────────
  async log(params: AuditParams): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId:  params.tenantId,
          userId:    params.userId,
          action:    params.action,
          tableName: params.tableName,
          recordId:  params.recordId,
          oldValues: params.oldValues ?? undefined,
          newValues: params.newValues ?? undefined,
          ipAddress: params.ipAddress,
        },
      });
    } catch (err) {
      // Never let audit logging failures break the main operation
      this.logger.error(
        `Failed to write audit log: ${params.action} on ${params.tableName}/${params.recordId}`,
        err,
      );
    }
  }

  // ── Query audit history for a record ─────────────────────────────────
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

  // ── Query audit history for a user ───────────────────────────────────
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
