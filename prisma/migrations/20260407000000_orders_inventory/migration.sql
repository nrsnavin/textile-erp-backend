-- Migration: orders enhancement + inventory schema (BOM, stock ledger, stock balances)

-- ── Orders enhancements ────────────────────────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS lines_json    JSONB,
  ADD COLUMN IF NOT EXISTS total_qty     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_styles  INTEGER NOT NULL DEFAULT 0;

-- Unique PO number per tenant
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_tenant_id_po_number_key;
ALTER TABLE orders
  ADD CONSTRAINT orders_tenant_id_po_number_key UNIQUE (tenant_id, po_number);

-- OrderLine enhancements
ALTER TABLE order_lines
  ADD COLUMN IF NOT EXISTS colour     TEXT,
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS currency   TEXT NOT NULL DEFAULT 'USD';

-- OrderRevision enhancements
ALTER TABLE order_revisions
  ADD COLUMN IF NOT EXISTS lines_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS reason         TEXT;

ALTER TABLE order_revisions
  DROP CONSTRAINT IF EXISTS order_revisions_order_id_revision_no_key;
ALTER TABLE order_revisions
  ADD CONSTRAINT order_revisions_order_id_revision_no_key UNIQUE (order_id, revision_no);

CREATE INDEX IF NOT EXISTS order_revisions_tenant_order_idx ON order_revisions (tenant_id, order_id);

-- ── BOM tables ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boms (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    UUID        NOT NULL,
  item_id      UUID        NOT NULL REFERENCES items(id),
  style_code   TEXT,
  version      INTEGER     NOT NULL DEFAULT 1,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  remarks      TEXT,
  created_by_id UUID       NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT boms_tenant_item_style_version_key UNIQUE (tenant_id, item_id, style_code, version)
);
CREATE INDEX IF NOT EXISTS boms_tenant_item_idx ON boms (tenant_id, item_id);

CREATE TABLE IF NOT EXISTS bom_lines (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    UUID        NOT NULL,
  bom_id       UUID        NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
  raw_item_id  UUID        NOT NULL REFERENCES items(id),
  qty          NUMERIC(14,4) NOT NULL,
  unit         TEXT        NOT NULL,
  wastage_pct  DOUBLE PRECISION NOT NULL DEFAULT 0,
  remarks      TEXT
);
CREATE INDEX IF NOT EXISTS bom_lines_tenant_bom_idx ON bom_lines (tenant_id, bom_id);

-- ── Inventory stock tables ──────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LedgerEntryType') THEN
    CREATE TYPE "LedgerEntryType" AS ENUM (
      'GRN_IN', 'ISSUE_TO_PROD', 'RETURN_FROM_PROD',
      'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'OPENING_STOCK'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS stock_ledger (
  id            UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID        NOT NULL,
  item_id       UUID        NOT NULL REFERENCES items(id),
  location      TEXT        NOT NULL DEFAULT 'MAIN',
  entry_type    "LedgerEntryType" NOT NULL,
  qty           NUMERIC(14,4) NOT NULL,
  balance_qty   NUMERIC(14,4) NOT NULL,
  rate          NUMERIC(14,2),
  ref_type      TEXT,
  ref_id        UUID,
  remarks       TEXT,
  created_by_id UUID        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_ledger_tenant_item_idx
  ON stock_ledger (tenant_id, item_id, location, created_at);

CREATE TABLE IF NOT EXISTS stock_balances (
  id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id  UUID        NOT NULL,
  item_id    UUID        NOT NULL REFERENCES items(id),
  location   TEXT        NOT NULL DEFAULT 'MAIN',
  on_hand    NUMERIC(14,4) NOT NULL DEFAULT 0,
  reserved   NUMERIC(14,4) NOT NULL DEFAULT 0,
  available  NUMERIC(14,4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_balances_tenant_item_location_key UNIQUE (tenant_id, item_id, location)
);
CREATE INDEX IF NOT EXISTS stock_balances_tenant_item_idx ON stock_balances (tenant_id, item_id);
