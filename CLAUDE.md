# Textile ERP — Backend (NestJS)

## Quick start

```bash
# Start infra
docker compose up -d

# Install dependencies (first time)
npm install

# Apply migrations
npx prisma migrate deploy

# Run dev server (port 3008)
npm run start:dev
```

## Tech stack

| Layer | Choice |
|-------|--------|
| Framework | NestJS 10 |
| ORM | Prisma 6 (PostgreSQL 16) |
| Auth | JWT (access 15m + refresh 7d rotation) + optional MFA (SHA-256 OTP) |
| Cache | Redis 7 (session tokens, OTP dedup) |
| Messaging | Kafka (KRaft, no ZooKeeper) via KafkaJS |
| Validation | class-validator + class-transformer |
| API docs | Swagger / OpenAPI 3 at `/api/docs` |
| Tests | Jest (unit + integration) |

## Folder structure

```
src/
  modules/
    auth/         # JWT strategy, login, MFA, refresh, register
    orders/       # Order CRUD + state machine (DRAFT→DISPATCHED)
    inventory/    # BOM, stock ledger, GRN posting, stock movements
    buyer/        # Buyer management
    suppliers/    # Supplier management
  shared/
    prisma/       # PrismaService (global, handles SPEC_EXPORT mode)
    guards/       # JwtAuthGuard, RolesGuard, TenantGuard, ThrottlerGuard
    decorators/   # @CurrentUser(), @CurrentTenant(), @Public(), @ApiAuth()
    filters/      # GlobalExceptionFilter
    interceptors/ # LoggingInterceptor, ResponseInterceptor
    services/     # KafkaService, RedisService, AuditService, EmailService
    utils/        # pagination, date helpers
  scripts/
    export-spec.ts  # Boot app without DB, write openapi.json (SPEC_EXPORT=1)
```

## Key conventions

- **Tenant isolation**: every DB query includes `{ tenantId }` in `where` — enforced by `@CurrentTenant()` decorator
- **Audit trail**: all mutations call `auditService.log()` with old/new values
- **Kafka events**: emitted after successful DB writes; KafkaService silently no-ops when broker is unavailable — HTTP response never depends on Kafka
- **RLS**: PostgreSQL row-level security policies live in `prisma/migrations/20260404000000_add_rls_policies/`
- **Role names**: `OWNER`, `MERCHANDISER`, `PRODUCTION_MGR`, `STORE_MANAGER`, `ACCOUNTANT`, `QC_INSPECTOR`

## Kafka topics emitted

| Topic | Emitted when |
|-------|-------------|
| `order.confirmed` | Order transitions DRAFT → CONFIRMED |
| `order.status-changed` | Any order status transition |
| `order.cancelled` | Order cancelled |
| `inventory.grn-posted` | GRN posted to inventory |

## Running tests

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:cov

# Specific module
npx jest orders --verbose
npx jest inventory --verbose
npx jest auth --verbose
```

## OpenAPI export (no DB required)

```bash
# Export spec from NestJS without a running database
npm run export-spec
# Writes: openapi.json at project root
```

## Database commands

```bash
# Create a new migration
npx prisma migrate dev --name describe_your_change

# Apply migrations to production
npx prisma migrate deploy

# Open Prisma Studio
npx prisma studio

# Generate Prisma client after schema changes
npx prisma generate
```

## Environment variables

Copy `.env.example` to `.env`. Key variables:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/textile_erp
REDIS_URL=redis://:redispassword@localhost:6379
KAFKA_BROKERS=localhost:9092
JWT_SECRET=change-me-in-production
JWT_REFRESH_SECRET=change-me-in-production
PORT=3008
```

## Common gotchas

- `SPEC_EXPORT=1` skips `prisma.$connect()` — used only by `export-spec.ts`
- `(this.prisma as any).modelName` casts are needed because Prisma client types aren't loaded in the `src/` compile step; the generated client lives in `node_modules`
- Kafka connection errors on startup are non-fatal — KafkaService logs a warning and marks `producerConnected = false`; all `emit()` calls become no-ops
