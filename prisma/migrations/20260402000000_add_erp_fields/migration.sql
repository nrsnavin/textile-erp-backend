-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add_erp_fields
--
-- 1. Create suppliers, purchase_orders, purchase_order_lines, grns, grn_lines,
--    and items tables (were missing from previous migrations)
-- 2. Add SAP-like fields to buyers (payment_terms, credit_limit, etc.)
-- 3. SAP-like vendor master fields are included directly in CREATE TABLE suppliers
-- ─────────────────────────────────────────────────────────────────────────────

-- 1a. suppliers ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "suppliers" (
  "id"             TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "tenant_id"      TEXT        NOT NULL,
  "name"           TEXT        NOT NULL,
  "gstin"          TEXT,
  "email"          TEXT,
  "phone"          TEXT,
  "address"        TEXT,
  "contact_person" TEXT,
  "services"       TEXT[]      NOT NULL DEFAULT '{}',
  "vendor_score"   FLOAT       NOT NULL DEFAULT 100,
  "is_active"      BOOLEAN     NOT NULL DEFAULT TRUE,
  -- SAP-like vendor master fields
  "pan"            TEXT,
  "payment_terms"  TEXT,
  "credit_days"    INTEGER,
  "bank_account"   TEXT,
  "bank_ifsc"      TEXT,
  "bank_name"      TEXT,
  "website"        TEXT,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "suppliers_tenant_id_idx" ON "suppliers"("tenant_id");

-- 1b. items ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "items" (
  "id"         TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "tenant_id"  TEXT    NOT NULL,
  "code"       TEXT    NOT NULL,
  "name"       TEXT    NOT NULL,
  "unit"       TEXT    NOT NULL,
  "category"   TEXT,
  "properties" JSONB,

  CONSTRAINT "items_pkey"              PRIMARY KEY ("id"),
  CONSTRAINT "items_tenant_code_uniq"  UNIQUE ("tenant_id", "code")
);

CREATE INDEX IF NOT EXISTS "items_tenant_id_idx" ON "items"("tenant_id");

-- 1c. purchase_orders ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "purchase_orders" (
  "id"            TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "tenant_id"     TEXT        NOT NULL,
  "supplier_id"   TEXT        NOT NULL,
  "po_number"     TEXT        NOT NULL,
  "status"        TEXT        NOT NULL DEFAULT 'DRAFT',
  "po_date"       TIMESTAMPTZ NOT NULL,
  "expected_date" TIMESTAMPTZ NOT NULL,
  "remarks"       TEXT,
  "sent_at"       TIMESTAMPTZ,
  "created_by_id" TEXT        NOT NULL,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_orders_supplier_fk"
    FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
);

CREATE INDEX IF NOT EXISTS "purchase_orders_tenant_supplier_idx"
  ON "purchase_orders"("tenant_id", "supplier_id");
CREATE INDEX IF NOT EXISTS "purchase_orders_tenant_status_idx"
  ON "purchase_orders"("tenant_id", "status");

-- 1d. purchase_order_lines ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "purchase_order_lines" (
  "id"           TEXT    NOT NULL DEFAULT gen_random_uuid()::text,
  "tenant_id"    TEXT    NOT NULL,
  "po_id"        TEXT    NOT NULL,
  "item_id"      TEXT    NOT NULL,
  "description"  TEXT,
  "qty"          FLOAT   NOT NULL,
  "unit"         TEXT    NOT NULL,
  "rate"         FLOAT   NOT NULL,
  "hsn_code"     TEXT,
  "gst_pct"      FLOAT   NOT NULL DEFAULT 18,
  "received_qty" FLOAT   NOT NULL DEFAULT 0,

  CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_lines_po_fk"
    FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "purchase_order_lines_tenant_po_idx"
  ON "purchase_order_lines"("tenant_id", "po_id");

-- 1e. grns ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "grns" (
  "id"            TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "tenant_id"     TEXT        NOT NULL,
  "supplier_id"   TEXT        NOT NULL,
  "po_id"         TEXT,
  "grn_number"    TEXT        NOT NULL,
  "status"        TEXT        NOT NULL DEFAULT 'DRAFT',
  "grn_date"      TIMESTAMPTZ NOT NULL,
  "invoice_no"    TEXT,
  "remarks"       TEXT,
  "created_by_id" TEXT        NOT NULL,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "grns_pkey"        PRIMARY KEY ("id"),
  CONSTRAINT "grns_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id"),
  CONSTRAINT "grns_po_fk"       FOREIGN KEY ("po_id")       REFERENCES "purchase_orders"("id")
);

CREATE INDEX IF NOT EXISTS "grns_tenant_supplier_idx" ON "grns"("tenant_id", "supplier_id");
CREATE INDEX IF NOT EXISTS "grns_tenant_status_idx"   ON "grns"("tenant_id", "status");

-- 1f. grn_lines ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "grn_lines" (
  "id"          TEXT  NOT NULL DEFAULT gen_random_uuid()::text,
  "tenant_id"   TEXT  NOT NULL,
  "grn_id"      TEXT  NOT NULL,
  "item_id"     TEXT  NOT NULL,
  "description" TEXT,
  "qty"         FLOAT NOT NULL,
  "unit"        TEXT  NOT NULL,
  "rate"        FLOAT NOT NULL,
  "hsn_code"    TEXT,
  "gst_pct"     FLOAT NOT NULL DEFAULT 18,
  "amount"      FLOAT NOT NULL,

  CONSTRAINT "grn_lines_pkey"   PRIMARY KEY ("id"),
  CONSTRAINT "grn_lines_grn_fk" FOREIGN KEY ("grn_id") REFERENCES "grns"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "grn_lines_tenant_grn_idx" ON "grn_lines"("tenant_id", "grn_id");

-- 2. Add SAP-like fields to buyers (suppliers fields already in CREATE TABLE above) ──

ALTER TABLE "buyers"
  ADD COLUMN IF NOT EXISTS "payment_terms"  TEXT,
  ADD COLUMN IF NOT EXISTS "credit_limit"   DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "credit_days"    INTEGER,
  ADD COLUMN IF NOT EXISTS "tax_id"         TEXT,
  ADD COLUMN IF NOT EXISTS "segment"        TEXT,
  ADD COLUMN IF NOT EXISTS "website"        TEXT;

-- Safety: add any supplier columns that may already exist in a partial state
ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "pan"           TEXT,
  ADD COLUMN IF NOT EXISTS "payment_terms" TEXT,
  ADD COLUMN IF NOT EXISTS "credit_days"   INTEGER,
  ADD COLUMN IF NOT EXISTS "bank_account"  TEXT,
  ADD COLUMN IF NOT EXISTS "bank_ifsc"     TEXT,
  ADD COLUMN IF NOT EXISTS "bank_name"     TEXT,
  ADD COLUMN IF NOT EXISTS "website"       TEXT;
