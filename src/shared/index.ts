// src/shared/index.ts
// Barrel export — import anything from shared with:
//   import { JwtAuthGuard, CurrentTenant, AuditService } from '../shared';

// ── Prisma ────────────────────────────────────────────────────────────────
export { PrismaService, tenantStorage } from './prisma/prisma.service';
export { PrismaModule }                 from './prisma/prisma.module';

// ── Guards ────────────────────────────────────────────────────────────────
export { JwtAuthGuard, IS_PUBLIC_KEY }  from './guards/jwt-auth.guard';
export { TenantGuard }                  from './guards/tenant.guard';
export { RolesGuard, Role }             from './guards/roles.guard';
export { CustomThrottlerGuard }         from './guards/throttler.guard';

// ── Decorators ────────────────────────────────────────────────────────────
export { Roles, ROLES_KEY }             from './decorators/roles.decorator';
export { Public }                       from './decorators/public.decorator';
export {
  CurrentUser,
  CurrentTenant,
  CurrentRoles,
  CurrentUserPayload,
  AuthUser,
}                                       from './decorators/current-user.decorator';
export { ApiAuth }                      from './decorators/api-auth.decorator';

// ── Filters ───────────────────────────────────────────────────────────────
export { GlobalExceptionFilter }        from './filters/global-exception.filter';

// ── Interceptors ──────────────────────────────────────────────────────────
export { ResponseInterceptor }          from './interceptors/response.interceptor';
export { LoggingInterceptor }           from './interceptors/logging.interceptor';

// ── Pipes ─────────────────────────────────────────────────────────────────
export { createValidationPipe }         from './pipes/validation.pipe';

// ── Services ─────────────────────────────────────────────────────────────
export { RedisService }                 from './services/redis.service';
export { KafkaService }                 from './services/kafka.service';
export { AuditService, AuditAction }    from './services/audit.service';
export { S3Service, S3Folder }          from './services/s3.service';
export { EmailService }                 from './services/email.service';
export { WhatsAppService }              from './services/whatsapp.service';
export { HealthService }                from './services/health.service';

// ── Utils ─────────────────────────────────────────────────────────────────
export {
  PaginationDto,
  PaginationMeta,
  paginate,
  dateRangeFilter,
  containsFilter,
}                                       from './utils/pagination.util';
export {
  hashPassword,
  comparePassword,
  hashToken,
  hashOtp,
  generateSecureToken,
  generateOtp,
  maskEmail,
  maskPhone,
}                                       from './utils/hash.util';
export {
  getWeekStart,
  addDays,
  daysBetween,
  isOverdue,
  formatIndianDate,
  getFinancialYear,
}                                       from './utils/date.util';
