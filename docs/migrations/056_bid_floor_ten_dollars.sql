-- 056: the minimum bid is $10, the same as the minimum listing price.
--
-- bids.amount_cents has carried CHECK (amount_cents >= 5000) since 004 — a $50 floor from when the
-- minimum listing price was also $50. The listing price floor was later lowered to $10 and this was
-- not, so the two disagreed for months. The bid route validated against the $10 listing floor, told
-- people "Bid must be at least $10", and Postgres then rejected anything under $50 with a raw
-- constraint name in an HTTP 500. On the one live auction, whose starting bid is $35, the page
-- pre-filled a $36 bid that could not be placed.
--
-- The owner's decision: one floor, $10, for listings and auctions alike. This moves the constraint
-- to match, and PRICE_FLOOR_CENTS in src/lib/money.js is now the single number both use.
--
-- Lowering a floor cannot invalidate an existing row, so there is nothing to migrate. The constraint
-- is dropped by name and recreated rather than altered, because a CHECK cannot be altered in place.

ALTER TABLE yp_labs.bids DROP CONSTRAINT IF EXISTS bids_amount_cents_check;

ALTER TABLE yp_labs.bids
  ADD CONSTRAINT bids_amount_cents_check CHECK (amount_cents >= 1000);
