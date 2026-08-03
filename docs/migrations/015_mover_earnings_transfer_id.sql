-- 015: record the Stripe transfer that paid each mover earning, for reconciliation and
-- audit. The earning id is also used as the transfer's idempotency key, so a paid earning
-- is provably tied to exactly one transfer.
ALTER TABLE yp_labs.mover_earnings
  ADD COLUMN IF NOT EXISTS stripe_transfer_id text;
