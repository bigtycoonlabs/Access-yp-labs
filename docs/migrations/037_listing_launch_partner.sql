-- 037: the creator can stay on as LAUNCH PARTNER when a project sells.
--
-- The buyer's real fear is not "is this idea any good" — it is "can I actually pull this off". The
-- best answer to that is the person who designed it. So a seller may offer to stay on and help, with
-- the FULL SCOPE declared in the listing before anyone pays: what they will help with, how much, and
-- for how long. No vague "I'll be around".
--
-- Deliberate limits:
--   * SERVICES ONLY. No equity is offered, arranged, or recorded through this platform.
--   * The platform takes NO extra fee for it — it is part of the sale price the seller sets.
--   * The buyer still receives the full transfer. The partner collaborates; they do not own it.
--   * The buyer can REMOVE the partner at any time, for any reason, without losing the project.

ALTER TABLE yp_labs.listings ADD COLUMN IF NOT EXISTS partner_offered  boolean NOT NULL DEFAULT false;
ALTER TABLE yp_labs.listings ADD COLUMN IF NOT EXISTS partner_areas    text[]  NOT NULL DEFAULT '{}';
ALTER TABLE yp_labs.listings ADD COLUMN IF NOT EXISTS partner_scope    text;    -- exactly what is included, in the seller's words
ALTER TABLE yp_labs.listings ADD COLUMN IF NOT EXISTS partner_sessions integer; -- how many sessions, if that is the shape
ALTER TABLE yp_labs.listings ADD COLUMN IF NOT EXISTS partner_weeks    integer; -- over how long

-- Whether the partner is still involved in a completed sale, and when the buyer ended it.
ALTER TABLE yp_labs.orders_transfers ADD COLUMN IF NOT EXISTS partner_active     boolean;
ALTER TABLE yp_labs.orders_transfers ADD COLUMN IF NOT EXISTS partner_removed_at timestamptz;
