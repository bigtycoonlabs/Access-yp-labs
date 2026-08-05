-- 030_store_orders.sql
-- Real storefront orders. A buyer purchasing a creator's product is a DIRECT charge on the
-- creator's own Stripe Connect account: the creator is the merchant of record, the creator bears
-- Stripe's processing fee, and the platform takes nothing (no application fee). This table is the
-- ledger of those sales.
--
-- Exactly-once: stripe_session_id is UNIQUE, so a retried checkout or a double-fired confirmation
-- can never create or pay an order twice. product_name / amount are denormalized onto the order so
-- the record stays truthful even if the product is later edited or removed.
CREATE TABLE IF NOT EXISTS store_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id        uuid NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  product_id        uuid REFERENCES store_products(id) ON DELETE SET NULL,
  seller_account_id text NOT NULL,
  amount_cents      integer NOT NULL CHECK (amount_cents >= 0),
  currency          text NOT NULL DEFAULT 'usd',
  product_name      text NOT NULL,
  buyer_email       text,
  stripe_session_id text UNIQUE,
  status            text NOT NULL DEFAULT 'pending',
  created_at        timestamptz NOT NULL DEFAULT now(),
  paid_at           timestamptz
);
CREATE INDEX IF NOT EXISTS store_orders_concept_idx ON store_orders(concept_id);
