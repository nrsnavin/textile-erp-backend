-- AlterTable buyers: SAP-like fields for customer master data
ALTER TABLE "buyers"
  ADD COLUMN IF NOT EXISTS "payment_terms"  TEXT,
  ADD COLUMN IF NOT EXISTS "credit_limit"   DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "credit_days"    INTEGER,
  ADD COLUMN IF NOT EXISTS "tax_id"         TEXT,
  ADD COLUMN IF NOT EXISTS "segment"        TEXT,
  ADD COLUMN IF NOT EXISTS "website"        TEXT;

-- AlterTable suppliers: SAP-like fields for vendor master data
ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "pan"            TEXT,
  ADD COLUMN IF NOT EXISTS "payment_terms"  TEXT,
  ADD COLUMN IF NOT EXISTS "credit_days"    INTEGER,
  ADD COLUMN IF NOT EXISTS "bank_account"   TEXT,
  ADD COLUMN IF NOT EXISTS "bank_ifsc"      TEXT,
  ADD COLUMN IF NOT EXISTS "bank_name"      TEXT,
  ADD COLUMN IF NOT EXISTS "website"        TEXT;
