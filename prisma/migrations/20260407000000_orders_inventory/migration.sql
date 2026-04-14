-- Migration: orders (create + enhance) + inventory schema (BOM, stock ledger, stock balances)

-- ── Create orders table (was never created in prior migrations) ────────────

CREATE TABLE IF NOT EXISTS orders (
  id            TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  tenant_id     TEXT        NOT NULL,
  po_number     TEXT        NOT NULL,
  buyer_id      TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'DRAFT',
  delivery_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  season        TEXT,
  remarks       TEXT,
  lines_json    JSONB,
  total_qty     INTEGER     NOT NULL DEFAULT 0,
  total_styles  INTEGER     NOT NULL DEFAULT 0,
  revision      INTEGER     NOT NULL DEFAULT 1,
  created_by_id TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT orders_tenant_po_number_key UNIQUE (tenant_id, po_number)
);
CREATE INDEX IF NOT EXISTS orders_tenant_id_idx     ON orders (tenant_id);
CREATE INDEX IF NOT EXISTS orders_tenant_status_idx ON orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS orders_tenant_buyer_idx  ON orders (tenant_id, buyer_id);

-- ── Create order_lines table ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS order_lines (
  id          TEXT          NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  tenant_id   TEXT          NOT NULL,
  order_id    TEXT          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  style_code  TEXT          NOT NULL,
  item_id     TEXT,
  colour      TEXT,
  qty         INTEGER       NOT NULL DEFAULT 0,
  sizes_json  JSONB,
  unit_price  NUMERIC(14,2),
  currency    TEXT          NOT NULL DEFAULT 'USD'
);
CREATE INDEX IF NOT EXISTS order_lines_tenant_order_idx ON order_lines (tenant_id, order_id);

-- ── Create order_revisions table ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS order_revisions (
  id              TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  tenant_id       TEXT        NOT NULL,
  order_id        TEXT        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  revision_no     INTEGER     NOT NULL,
  lines_snapshot  JSONB,
  reason          TEXT,
  created_by_id   TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_revisions_order_revision_key UNIQUE (order_id, revision_no)
);
CREATE INDEX IF NOT EXISTS order_revisions_tenant_order_idx ON order_revisions (tenant_id, order_id);

-- ── BOM tables ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boms (
  id            TEXT        NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  tenant_id     TEXT        NOT NULL,
  item_id       TEXT        NOT NULL REFERENCES items(id),
  style_code    TEXT,
  version       INTEGER     NOT NULL DEFAULT 1,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  remarks       TEXT,
  created_by_id TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT boms_tenant_item_style_version_key UNIQUE (tenant_id, item_id, style_code, version)
);
CREATE INDEX IF NOT EXISTS boms_tenant_item_idx ON boms (tenant_id, item_id);

CREATE TABLE IF NOT EXISTS bom_lines (
  id           TEXT           NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  tenant_id    TEXT           NOT NULL,
  bom_id       TEXT           NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
  raw_item_id  TEXT           NOT NULL REFERENCES items(id),
  qty          NUMERIC(14,4)  NOT NULL,
  unit         TEXT           NOT NULL,
  wastage_pct  DOUBLE PRECISION NOT NULL DEFAULT 0,
  remarks      TEXT
);
CREATE INDEX IF NOT EXISTS bom_lines_tenant_bom_idx ON bom_lines (tenant_id, bom_id);

-- ── Inventory stock tables ─────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LedgerEntryType') THEN
    CREATE TYPE "LedgerEntryType" AS ENUM (
      'GRN_IN', 'ISSUE_TO_PROD', 'RETURN_FROM_PROD',
      'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'OPENING_STOCK'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS stock_ledger (
  id            TEXT           NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  tenant_id     TEXT           NOT NULL,
  item_id       TEXT           NOT NULL REFERENCES items(id),
  location      TEXT           NOT NULL DEFAULT 'MAIN',
  entry_type    "LedgerEntryType" NOT NULL,
  qty           NUMERIC(14,4)  NOT NULL,
  balance_qty   NUMERIC(14,4)  NOT NULL,
  rate          NUMERIC(14,2),
  ref_type      TEXT,
  ref_id        TEXT,
  remarks       TEXT,
  created_by_id TEXT           NOT NULL,
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS stock_ledger_tenant_item_idx
  ON stock_ledger (tenant_id, item_id, location, created_at);

CREATE TABLE IF NOT EXISTS stock_balances (
  id         TEXT           NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY,
  tenant_id  TEXT           NOT NULL,
  item_id    TEXT           NOT NULL REFERENCES items(id),
  location   TEXT           NOT NULL DEFAULT 'MAIN',
  on_hand    NUMERIC(14,4)  NOT NULL DEFAULT 0,
  reserved   NUMERIC(14,4)  NOT NULL DEFAULT 0,
  available  NUMERIC(14,4)  NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CONSTRAINT stock_balances_tenant_item_location_key UNIQUE (tenant_id, item_id, location)
);
CREATE INDEX IF NOT EXISTS stock_balances_tenant_item_idx ON stock_balances (tenant_id, item_id);
