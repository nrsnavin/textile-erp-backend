-- Migration: fix_buyers_missing_columns
-- Adds columns that exist in the Prisma schema but were missing from the original
-- buyer migration (20260329092728_add_buyer).

ALTER TABLE "buyers"
  ADD COLUMN IF NOT EXISTS "phone"      TEXT,
  ADD COLUMN IF NOT EXISTS "address"    TEXT,
  ADD COLUMN IF NOT EXISTS "is_active"  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW();
