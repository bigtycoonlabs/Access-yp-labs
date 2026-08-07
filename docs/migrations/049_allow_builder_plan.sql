-- The subscriptions table only permitted 'maker' and 'sculptor' — both retired. 'builder' is the
-- ONLY plan we sell, and the database refused to store it. The first real subscriber would have been
-- charged by Stripe and then the webhook insert would have thrown, leaving someone paying for a
-- subscription with no record of it on our side. Found by trying to subscribe a test creator.
ALTER TABLE yp_labs.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE yp_labs.subscriptions ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan = ANY (ARRAY['builder'::text, 'maker'::text, 'sculptor'::text, 'site_addon'::text]));
