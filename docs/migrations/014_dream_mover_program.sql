-- 014: The Dream Mover referral program. A Dream Mover promotes OTHER creators' Dreams
-- and earns 5% of any sale they drive through their promo link — paid out of the
-- platform's 20% take, never out of the seller's 80%. This is what lets someone create
-- AND sell Dreams for a living.
--
-- Money integrity: earnings are a ledger, ONE row per released order, keyed UNIQUE by
-- order so the 5% can only ever accrue once. Attribution is stamped on the order at
-- creation; the earning is written inside the release transaction, atomically with the
-- sale itself.

CREATE TABLE IF NOT EXISTS yp_labs.dream_movers (
  user_id     uuid PRIMARY KEY REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  slug        text UNIQUE NOT NULL,
  headline    text,
  bio         text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Dreams a mover has chosen to promote on their page ("concepts they believe in").
CREATE TABLE IF NOT EXISTS yp_labs.mover_promotions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mover_id    uuid NOT NULL REFERENCES yp_labs.dream_movers(user_id) ON DELETE CASCADE,
  listing_id  uuid NOT NULL REFERENCES yp_labs.listings(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mover_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_mover_promotions_mover ON yp_labs.mover_promotions(mover_id);

-- Earnings ledger: the 5% owed to a mover for a sale they drove. ONE row per released
-- order, keyed UNIQUE by order so the commission can only ever accrue once.
CREATE TABLE IF NOT EXISTS yp_labs.mover_earnings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mover_id     uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  order_id     uuid NOT NULL UNIQUE REFERENCES yp_labs.orders_transfers(id) ON DELETE CASCADE,
  listing_id   uuid REFERENCES yp_labs.listings(id) ON DELETE SET NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  paid_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_mover_earnings_mover ON yp_labs.mover_earnings(mover_id, status);

-- Attribution: which mover drove this order (stamped at order creation from the promo link).
ALTER TABLE yp_labs.orders_transfers
  ADD COLUMN IF NOT EXISTS referred_by_mover_id uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL;
