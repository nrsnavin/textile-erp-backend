-- Migration: movement_ledger_schema
-- Adds location to grns and accepted_qty to grn_lines
-- so that postGrn() can read the correct warehouse location
-- and use the accepted quantity rather than the ordered quantity.

ALTER TABLE grns      ADD COLUMN IF NOT EXISTS location     TEXT NOT NULL DEFAULT 'MAIN';
ALTER TABLE grn_lines ADD COLUMN IF NOT EXISTS accepted_qty FLOAT;
