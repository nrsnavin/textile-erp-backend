-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add_tenant_role_config
--
-- Changes:
--   1. Add TenantPlan / TenantStatus enums
--   2. Expand tenants table with plan, status, subscription, and identity columns
--   3. Add ConfigCategory enum and tenant_config table
--   4. Add roles table (system + tenant-custom)
--   5. Add user_roles junction table
--   6. Add FK from users.tenant_id → tenants.id
--   7. Seed system roles with default permissions
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE "TenantPlan" AS ENUM ('STARTER', 'GROWTH', 'ENTERPRISE');
CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED');
CREATE TYPE "ConfigCategory" AS ENUM (
  'GENERAL', 'NOTIFICATIONS', 'INTEGRATIONS', 'BILLING', 'WORKFLOW', 'FEATURES'
);

-- 2. Expand tenants ───────────────────────────────────────────────────────────

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "plan"              "TenantPlan"   NOT NULL DEFAULT 'STARTER',
  ADD COLUMN IF NOT EXISTS "status"            "TenantStatus" NOT NULL DEFAULT 'TRIAL',
  ADD COLUMN IF NOT EXISTS "trial_ends_at"     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "subscribed_at"     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "plan_renewal_at"   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "industry"          TEXT,
  ADD COLUMN IF NOT EXISTS "country"           TEXT          NOT NULL DEFAULT 'IN',
  ADD COLUMN IF NOT EXISTS "timezone"          TEXT          NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS "currency"          TEXT          NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS "logo_url"          TEXT,
  ADD COLUMN IF NOT EXISTS "website"           TEXT,
  ADD COLUMN IF NOT EXISTS "gstin"             TEXT,
  ADD COLUMN IF NOT EXISTS "pan"               TEXT,
  ADD COLUMN IF NOT EXISTS "max_users"         INTEGER       NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "updated_at"        TIMESTAMPTZ   NOT NULL DEFAULT NOW();

-- Back-fill trial_ends_at for existing rows (14 days from creation)
UPDATE "tenants"
   SET "trial_ends_at" = "created_at" + INTERVAL '14 days'
 WHERE "trial_ends_at" IS NULL;

-- 3. TenantConfig ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "tenant_config" (
  "id"           TEXT          NOT NULL DEFAULT gen_random_uuid()::text,
  "tenant_id"    TEXT          NOT NULL,
  "category"     "ConfigCategory" NOT NULL,
  "key"          TEXT          NOT NULL,
  "value"        JSONB         NOT NULL,
  "description"  TEXT,
  "is_public"    BOOLEAN       NOT NULL DEFAULT FALSE,
  "is_encrypted" BOOLEAN       NOT NULL DEFAULT FALSE,
  "created_at"   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updated_at"   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT "tenant_config_pkey"              PRIMARY KEY ("id"),
  CONSTRAINT "tenant_config_tenant_key_unique" UNIQUE ("tenant_id", "key"),
  CONSTRAINT "tenant_config_tenant_fk"         FOREIGN KEY ("tenant_id")
      REFERENCES "tenants" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "tenant_config_tenant_category_idx"
    ON "tenant_config" ("tenant_id", "category");

-- 4. Roles ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "roles" (
  "id"          TEXT      NOT NULL DEFAULT gen_random_uuid()::text,
  "tenant_id"   TEXT,                              -- NULL = system-wide
  "name"        TEXT      NOT NULL,
  "description" TEXT,
  "permissions" TEXT[]    NOT NULL DEFAULT '{}',
  "is_system"   BOOLEAN   NOT NULL DEFAULT FALSE,
  "is_active"   BOOLEAN   NOT NULL DEFAULT TRUE,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "roles_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "roles_tenant_name_unique" UNIQUE ("tenant_id", "name"),
  CONSTRAINT "roles_tenant_fk"     FOREIGN KEY ("tenant_id")
      REFERENCES "tenants" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "roles_tenant_id_idx" ON "roles" ("tenant_id");

-- 5. UserRole junction ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "user_roles" (
  "id"             TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id"        TEXT        NOT NULL,
  "role_id"        TEXT        NOT NULL,
  "tenant_id"      TEXT        NOT NULL,
  "assigned_by_id" TEXT,
  "assigned_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expires_at"     TIMESTAMPTZ,

  CONSTRAINT "user_roles_pkey"            PRIMARY KEY ("id"),
  CONSTRAINT "user_roles_user_role_unique" UNIQUE ("user_id", "role_id"),
  CONSTRAINT "user_roles_user_fk"         FOREIGN KEY ("user_id")
      REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "user_roles_role_fk"         FOREIGN KEY ("role_id")
      REFERENCES "roles" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "user_roles_tenant_user_idx" ON "user_roles" ("tenant_id", "user_id");
CREATE INDEX IF NOT EXISTS "user_roles_tenant_role_idx" ON "user_roles" ("tenant_id", "role_id");

-- 6. FK from users.tenant_id → tenants.id ─────────────────────────────────────
--    Only add if it doesn't already exist (idempotent)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'users_tenant_fk'
       AND table_name = 'users'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_tenant_fk"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id");
  END IF;
END $$;

-- 7. Seed system roles ─────────────────────────────────────────────────────────
--    tenant_id = NULL makes these global templates.
--    ON CONFLICT DO NOTHING makes this idempotent.

INSERT INTO "roles"
  ("id", "tenant_id", "name", "description", "permissions", "is_system", "is_active")
VALUES
  -- OWNER: unrestricted
  (gen_random_uuid()::text, NULL, 'OWNER', 'Full system access — tenant administrator',
   ARRAY[
     'buyers:read','buyers:write','buyers:delete',
     'suppliers:read','suppliers:write',
     'orders:read','orders:confirm','orders:cancel','orders:revise',
     'invoices:read','invoices:create','invoices:approve','invoices:void',
     'reports:read','reports:export',
     'settings:read','settings:write',
     'users:read','users:write','users:assign-roles',
     'audit:read'
   ], TRUE, TRUE),

  -- MERCHANDISER: buyers, orders, reports
  (gen_random_uuid()::text, NULL, 'MERCHANDISER', 'Manages buyer orders and styles',
   ARRAY[
     'buyers:read','buyers:write',
     'orders:read','orders:confirm','orders:revise',
     'invoices:read',
     'reports:read'
   ], TRUE, TRUE),

  -- PRODUCTION_MGR: orders, GRN, QC
  (gen_random_uuid()::text, NULL, 'PRODUCTION_MGR', 'Oversees production, GRN, and QC',
   ARRAY[
     'orders:read','orders:confirm','orders:cancel',
     'suppliers:read',
     'reports:read','reports:export',
     'audit:read'
   ], TRUE, TRUE),

  -- STORE_MANAGER: suppliers, POs, GRN
  (gen_random_uuid()::text, NULL, 'STORE_MANAGER', 'Manages supplier POs and goods receipt',
   ARRAY[
     'suppliers:read','suppliers:write',
     'orders:read',
     'reports:read'
   ], TRUE, TRUE),

  -- SUPERVISOR: production visibility
  (gen_random_uuid()::text, NULL, 'SUPERVISOR', 'Line supervisor — read-only on orders and stock',
   ARRAY[
     'orders:read',
     'suppliers:read',
     'reports:read'
   ], TRUE, TRUE),

  -- QC_INSPECTOR: QC results only
  (gen_random_uuid()::text, NULL, 'QC_INSPECTOR', 'Creates and updates QC inspections',
   ARRAY[
     'orders:read',
     'reports:read'
   ], TRUE, TRUE),

  -- ACCOUNTANT: invoices, payments, reports
  (gen_random_uuid()::text, NULL, 'ACCOUNTANT', 'Manages invoices, payments, and financial reports',
   ARRAY[
     'buyers:read',
     'suppliers:read',
     'orders:read',
     'invoices:read','invoices:create','invoices:approve','invoices:void',
     'reports:read','reports:export',
     'audit:read'
   ], TRUE, TRUE),

  -- BUYER (external): read own orders only
  (gen_random_uuid()::text, NULL, 'BUYER', 'External buyer portal — own orders only',
   ARRAY[
     'buyers:read',
     'orders:read',
     'invoices:read'
   ], TRUE, TRUE),

  -- SUPPLIER (external): read own POs only
  (gen_random_uuid()::text, NULL, 'SUPPLIER', 'External supplier portal — own POs only',
   ARRAY[
     'suppliers:read',
     'orders:read'
   ], TRUE, TRUE)

ON CONFLICT ("tenant_id", "name") DO NOTHING;
