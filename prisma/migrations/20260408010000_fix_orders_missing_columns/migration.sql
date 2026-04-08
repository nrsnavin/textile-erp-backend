-- Migration: fix_orders_missing_columns
-- Adds columns that exist in the Prisma schema but were missing from the
-- orders table created in 20260407000000_orders_inventory.

-- 1. Create OrderStatus enum if not exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderStatus') THEN
    CREATE TYPE "OrderStatus" AS ENUM (
      'DRAFT', 'CONFIRMED', 'IN_PRODUCTION', 'QC_PASSED', 'DISPATCHED', 'CANCELLED'
    );
  END IF;
END $$;

-- 2. orders — add missing columns
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_at      TIMESTAMPTZ;

-- 3. Migrate status column from TEXT to OrderStatus enum
--    (safe: all existing rows will have status 'DRAFT' by default)
ALTER TABLE orders
  ALTER COLUMN status TYPE "OrderStatus" USING status::"OrderStatus";

-- 4. order_revisions — add changed_fields (required JSON) and revised_by_id
ALTER TABLE order_revisions
  ADD COLUMN IF NOT EXISTS changed_fields JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS revised_by_id  TEXT;

-- Back-fill revised_by_id from created_by_id if the old column exists
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_revisions' AND column_name = 'created_by_id'
  ) THEN
    UPDATE order_revisions SET revised_by_id = created_by_id WHERE revised_by_id IS NULL;
    ALTER TABLE order_revisions DROP COLUMN IF EXISTS created_by_id;
  END IF;
END $$;

-- 5. order_lines — ensure item_id is not nullable (schema has it required)
--    Only alter if column exists and is nullable
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_lines' AND column_name = 'item_id' AND is_nullable = 'YES'
  ) THEN
    -- Set a default for any NULL rows before adding NOT NULL constraint
    UPDATE order_lines SET item_id = '' WHERE item_id IS NULL;
    ALTER TABLE order_lines ALTER COLUMN item_id SET NOT NULL;
  END IF;
END $$;

-- 6. Add missing indexes
CREATE INDEX IF NOT EXISTS orders_tenant_status_delivery_idx
  ON orders (tenant_id, status, delivery_date);
CREATE INDEX IF NOT EXISTS orders_tenant_buyer_idx
  ON orders (tenant_id, buyer_id);
