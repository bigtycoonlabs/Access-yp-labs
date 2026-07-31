-- Self-cancel keeps paid access until the current period ends. This flag marks a subscription
-- that is scheduled to stop renewing; the row stays 'active' (so entitlement continues) until
-- Stripe's customer.subscription.deleted fires at period end and flips it to 'canceled'.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;
