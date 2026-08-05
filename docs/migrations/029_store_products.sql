-- 029_store_products.sql
-- Storefronts. A concept can be an e-commerce site, not just a content or brochure site: it can
-- carry real products with real prices. This is the catalog behind that — one row per product,
-- owned by the concept's owner, money held in integer cents to avoid float drift. Building the
-- catalog (add/list/edit) is free and reversible; it does not move money. Taking payment is a
-- separate, deliberate step handled through the platform's existing Stripe Connect (the creator's
-- own connected account), decided and wired on top of this — never silently.
CREATE TABLE IF NOT EXISTS store_products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id   uuid NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  owner_id     uuid NOT NULL,
  name         text NOT NULL,
  price_cents  integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency     text NOT NULL DEFAULT 'usd',
  description  text,
  image_url    text,
  active       boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_products_concept_idx ON store_products(concept_id);
