-- 072: THE DESK AND OFFICE PLANS. Owner's decision, 16 September 2026: Desk at $55 a month, Office at
-- $99 a month. The $19 'builder' plan is retired for new subscribers and still honoured for anyone
-- holding it. billing records whether a subscription is paid monthly or yearly.
ALTER TABLE yp_labs.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE yp_labs.subscriptions ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan IN ('desk', 'office', 'builder', 'maker', 'sculptor', 'site_addon'));
ALTER TABLE yp_labs.subscriptions ADD COLUMN IF NOT EXISTS billing text NOT NULL DEFAULT 'monthly';
ALTER TABLE yp_labs.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_billing_check;
ALTER TABLE yp_labs.subscriptions ADD CONSTRAINT subscriptions_billing_check CHECK (billing IN ('monthly', 'yearly'));
