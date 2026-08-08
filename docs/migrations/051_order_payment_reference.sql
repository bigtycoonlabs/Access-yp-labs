-- WITHOUT THIS, A REFUND IS IMPOSSIBLE — even by hand.
--
-- orders_transfers recorded who bought what and for how much, but nothing identifying the PAYMENT.
-- No checkout session, no payment intent. So when the code told a buyer "your payment will be
-- refunded" after a double-sale, there was no way to act on it: you could not find the charge from
-- the order, and there was no refund function in the Stripe service either. A promise with nothing
-- behind it.
--
-- Recorded at checkout so the reference exists from the moment money is involved, rather than being
-- reconstructed from Stripe later by matching amounts and timestamps, which is guesswork.
ALTER TABLE yp_labs.orders_transfers ADD COLUMN IF NOT EXISTS stripe_session_id text;
ALTER TABLE yp_labs.orders_transfers ADD COLUMN IF NOT EXISTS stripe_payment_intent text;
ALTER TABLE yp_labs.orders_transfers ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
ALTER TABLE yp_labs.orders_transfers ADD COLUMN IF NOT EXISTS refund_reason text;

CREATE INDEX IF NOT EXISTS orders_transfers_session_idx
  ON yp_labs.orders_transfers (stripe_session_id) WHERE stripe_session_id IS NOT NULL;
