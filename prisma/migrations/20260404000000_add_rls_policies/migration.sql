-- ============================================================================
-- Row-Level Security (RLS) for multi-tenant isolation
--
-- HOW IT WORKS
-- ─────────────
-- 1. Every request sets two PostgreSQL session variables at the start of
--    each transaction (via PrismaService middleware):
--
--       SET LOCAL app.current_tenant_id = '<uuid>';
--       SET LOCAL app.current_user_id   = '<uuid>';
--       SET LOCAL app.current_role      = 'OWNER';   -- highest role name
--
-- 2. RLS policies on each table call current_setting('app.current_tenant_id')
--    to filter rows.  Any query that does NOT set the variable returns NO rows
--    (the empty-string default does not match any real tenant_id).
--
-- 3. The application DB role (app_user) has BYPASSRLS = false.
--    A separate migration-only / admin role (app_admin) has BYPASSRLS = true
--    so Prisma migrations and seeding work without touching session vars.
--
-- 4. OWNER users bypass data-level RLS via a separate policy clause so they
--    can manage their own tenant without granting SQL superuser privileges.
--
-- ============================================================================

-- ── Schema guard (MUST come before any app.* function definitions) ───────────
CREATE SCHEMA IF NOT EXISTS app;

-- ── Helper functions ─────────────────────────────────────────────────────────
-- Returns the current tenant UUID from the session variable, or '' if not set.

CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT current_setting('app.current_tenant_id', true)
$$;

-- Returns the current user UUID (used for user self-access policy).
CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT current_setting('app.current_user_id', true)
$$;

-- Returns the highest role name in the session (used for OWNER bypass).
CREATE OR REPLACE FUNCTION app.current_role_name()
RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT current_setting('app.current_role', true)
$$;


-- ── tenants table ────────────────────────────────────────────────────────────

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

CREATE POLICY tenants_select
  ON tenants
  FOR SELECT
  USING (
    id = app.current_tenant_id()
  );

CREATE POLICY tenants_update
  ON tenants
  FOR UPDATE
  USING (
    id = app.current_tenant_id()
    AND app.current_role_name() = 'OWNER'
  )
  WITH CHECK (
    id = app.current_tenant_id()
  );


-- ── users table ──────────────────────────────────────────────────────────────

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY users_select
  ON users
  FOR SELECT
  USING (
    tenant_id = app.current_tenant_id()
    OR id = app.current_user_id()
  );

CREATE POLICY users_insert
  ON users
  FOR INSERT
  WITH CHECK (
    tenant_id = app.current_tenant_id()
  );

CREATE POLICY users_update
  ON users
  FOR UPDATE
  USING (
    tenant_id = app.current_tenant_id()
    AND (
      id = app.current_user_id()
      OR app.current_role_name() = 'OWNER'
    )
  )
  WITH CHECK (
    tenant_id = app.current_tenant_id()
  );

CREATE POLICY users_delete
  ON users
  FOR DELETE
  USING (
    tenant_id = app.current_tenant_id()
    AND app.current_role_name() = 'OWNER'
  );


-- ── roles table ──────────────────────────────────────────────────────────────

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;

CREATE POLICY roles_select
  ON roles
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = app.current_tenant_id()
  );

CREATE POLICY roles_insert
  ON roles
  FOR INSERT
  WITH CHECK (
    tenant_id = app.current_tenant_id()
    AND app.current_role_name() = 'OWNER'
  );

CREATE POLICY roles_update
  ON roles
  FOR UPDATE
  USING (
    tenant_id = app.current_tenant_id()
    AND app.current_role_name() = 'OWNER'
    AND is_system = false
  )
  WITH CHECK (
    tenant_id = app.current_tenant_id()
  );

CREATE POLICY roles_delete
  ON roles
  FOR DELETE
  USING (
    tenant_id = app.current_tenant_id()
    AND app.current_role_name() = 'OWNER'
    AND is_system = false
  );


-- ── user_roles junction table ─────────────────────────────────────────────────

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;

CREATE POLICY user_roles_select
  ON user_roles
  FOR SELECT
  USING (
    tenant_id = app.current_tenant_id()
    OR user_id = app.current_user_id()
  );

CREATE POLICY user_roles_insert
  ON user_roles
  FOR INSERT
  WITH CHECK (
    tenant_id = app.current_tenant_id()
    AND app.current_role_name() = 'OWNER'
  );

CREATE POLICY user_roles_delete
  ON user_roles
  FOR DELETE
  USING (
    tenant_id = app.current_tenant_id()
    AND app.current_role_name() = 'OWNER'
  );


-- ── tenant_config table ───────────────────────────────────────────────────────

ALTER TABLE tenant_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_config FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_config_select
  ON tenant_config
  FOR SELECT
  USING (
    tenant_id = app.current_tenant_id()
    AND (
      is_public = true
      OR app.current_role_name() = 'OWNER'
    )
  );

CREATE POLICY tenant_config_write
  ON tenant_config
  FOR ALL
  USING (
    tenant_id = app.current_tenant_id()
    AND app.current_role_name() = 'OWNER'
  )
  WITH CHECK (
    tenant_id = app.current_tenant_id()
  );


-- ── buyers / suppliers / purchase_orders — tenant boundary only ──────────────
-- Fine-grained permission checks (buyers:read, orders:confirm, etc.) are
-- handled at the application layer (RBAC guard + @RequirePermissions).
-- RLS here enforces the hard tenant boundary as a defense-in-depth layer.

ALTER TABLE buyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyers FORCE ROW LEVEL SECURITY;

CREATE POLICY buyers_tenant_isolation
  ON buyers FOR ALL
  USING  (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;

CREATE POLICY suppliers_tenant_isolation
  ON suppliers FOR ALL
  USING  (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;

CREATE POLICY purchase_orders_tenant_isolation
  ON purchase_orders FOR ALL
  USING  (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

-- NOTE: orders and invoices tables are not yet created in this migration set.
-- RLS for those tables will be added in the migration that creates them.


-- ── Grant table permissions to app_user role (only if the role exists) ───────
-- app_user: normal application queries (RLS enforced)
-- app_admin: migrations, seeding (BYPASSRLS)
-- Create these roles outside migrations via your DB init script.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON tenants         TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON users           TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON roles           TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON user_roles      TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_config   TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON buyers          TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON suppliers       TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_orders TO app_user;
    GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO app_user;
    GRANT EXECUTE ON FUNCTION app.current_user_id()   TO app_user;
    GRANT EXECUTE ON FUNCTION app.current_role_name() TO app_user;
  END IF;
END $$;
