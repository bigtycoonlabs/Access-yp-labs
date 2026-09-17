-- 073: BUNDLES WITH YP FLOW. One Stripe subscription covers a Labs plan and a Flow tier (owner,
-- 16 September 2026). Labs records its half here; Flow records its half on its own user row.
-- plan_welcomed_at marks the Labs welcome as sent, so a redelivered event never sends it twice.
ALTER TABLE yp_labs.subscriptions ADD COLUMN IF NOT EXISTS bundle text;
ALTER TABLE yp_labs.subscriptions ADD COLUMN IF NOT EXISTS flow_tier text;
ALTER TABLE yp_labs.subscriptions ADD COLUMN IF NOT EXISTS plan_welcomed_at timestamptz;
ALTER TABLE yp_labs.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_bundle_check;
ALTER TABLE yp_labs.subscriptions ADD CONSTRAINT subscriptions_bundle_check CHECK (
  (bundle IS NULL AND flow_tier IS NULL)
  OR (bundle = 'desk_flow' AND plan = 'desk' AND flow_tier = 'flow')
  OR (bundle = 'desk_power' AND plan = 'desk' AND flow_tier = 'power')
  OR (bundle = 'office_master' AND plan = 'office' AND flow_tier = 'master'));

-- The webhook's ON CONFLICT (stripe_subscription_id) needs this unique index. Production has had it
-- since before the migrations were collected, but no migration created it, so a database rebuilt from
-- this folder refused every subscription payment (found 16 Sept 2026 by driving a signed event).
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_sub_id_key ON yp_labs.subscriptions (stripe_subscription_id);
