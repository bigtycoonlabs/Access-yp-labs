-- 031_product_kind.sql
-- Products can be DIGITAL or PHYSICAL. Digital goods can carry a delivery link shown to the buyer
-- after payment; physical goods collect a shipping address at checkout, stored on the order so the
-- seller knows where to ship. Default 'digital' — the common case for an ideas/creator platform,
-- and safe for existing rows.
ALTER TABLE store_products ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'digital';
ALTER TABLE store_products ADD COLUMN IF NOT EXISTS fulfillment_url text;
DO $$ BEGIN
  ALTER TABLE store_products ADD CONSTRAINT store_products_kind_chk CHECK (kind IN ('digital','physical'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Captured shipping address for a physical order (plain text, exactly as Stripe collected it).
ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS shipping text;
