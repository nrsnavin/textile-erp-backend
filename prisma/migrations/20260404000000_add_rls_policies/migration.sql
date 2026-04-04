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

-- ── Helper function ──────────────────────────────────────────────────────────
-- Returns the current tenant UUID from the session variable, or '' if not set.
-- Used in every policy expression below.

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

-- ── Schema guard ─────────────────────────────────────────────────────────────
-- The helper functions live in the app schema which must exist.
CREATE SCHEMA IF NOT EXISTS app;

-- ── tenants table ────────────────────────────────────────────────────────────

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;   -- applies to table owner too

-- SELECT: a session may only read its own tenant row.
-- OWNER users can read their tenant (no extra clause needed — same condition).
CREATE POLICY tenants_select
  ON tenants
  FOR SELECT
  USING (
    id = app.current_tenant_id()
  );

-- INSERT: only the admin DB role (BYPASSRLS) can create tenants.
-- Application code goes through an admin service layer, never direct INSERT.
-- No INSERT policy → INSERT blocked for app_user (default-deny).

-- UPDATE: OWNER role may update their own tenant row.
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

-- DELETE: blocked for all application roles (admin only via BYPASSRLS).


-- ── users table ──────────────────────────────────────────────────────────────

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- SELECT: see users in the same tenant.
-- Additionally, a user can always see themselves (cross-tenant support for
-- super-admin accounts that span multiple tenants is handled at app layer).
CREATE POLICY users_select
  ON users
  FOR SELECT
  USING (
    tenant_id = app.current_tenant_id()
    OR id = app.current_user_id()        -- self-access (e.g. /me endpoint)
  );

-- INSERT: OWNER or users:write permission holders can invite new users.
-- The permission check is done at the application layer (RBAC guard).
-- Here we just enforce tenant boundary: new user must belong to same tenant.
CREATE POLICY users_insert
  ON users
  FOR INSERT
  WITH CHECK (
    tenant_id = app.current_tenant_id()
  );

-- UPDATE: users can update themselves; OWNER can update anyone in tenant.
CREATE POLICY users_update
  ON users
  FOR UPDATE
  USING (
    tenant_id = app.current_tenant_id()
    AND (
      id = app.current_user_id()          -- self-update (change password, etc.)
      OR app.current_role_name() = 'OWNER'
    )
  )
  WITH CHECK (
    tenant_id = app.current_tenant_id()
  );

-- DELETE (soft-delete): OWNER only, within same tenant.
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

-- System roles (tenant_id IS NULL) are readable by everyone.
-- Tenant-custom roles are visible only within that tenant.
CREATE POLICY roles_select
  ON roles
  FOR SELECT
  USING (
    tenant_id IS NULL                          -- system-wide roles (seeded)
    OR tenant_id = app.current_tenant_id()     -- tenant-specific custom roles
  );

-- INSERT/UPDATE/DELETE for custom roles: OWNER only, within tenant.
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
    AND is_system = false                      -- system roles are immutable
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
    OR user_id = app.current_user_id()         -- see own role assignments
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

-- All authenticated users can read public config (is_public = true).
-- OWNER sees everything including private / encrypted config.
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


-- ── buyers / suppliers / orders — tenant boundary only ───────────────────────
-- Fine-grained permission checks (buyers:read, orders:confirm, etc.) are
-- handled at the application layer (RBAC guard + @RequirePermissions).
-- RLS here just enforces the hard tenant boundary as a defense-in-depth layer.

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

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;

CREATE POLICY orders_tenant_isolation
  ON orders FOR ALL
  USING  (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

CREATE POLICY invoices_tenant_isolation
  ON invoices FOR ALL
  USING  (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;

CREATE POLICY purchase_orders_tenant_isolation
  ON purchase_orders FOR ALL
  USING  (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());


-- ── Grant table permissions to app role ──────────────────────────────────────
-- app_user: normal application queries (RLS enforced)
-- app_admin: migrations, seeding (BYPASSRLS)
-- Create these roles outside migrations via your DB init script.

GRANT SELECT, INSERT, UPDATE, DELETE ON tenants        TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON users          TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON roles          TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_roles     TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_config  TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON buyers         TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON suppliers      TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON orders         TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON invoices       TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_orders TO app_user;

GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO app_user;
GRANT EXECUTE ON FUNCTION app.current_user_id()   TO app_user;
GRANT EXECUTE ON FUNCTION app.current_role_name() TO app_user;
