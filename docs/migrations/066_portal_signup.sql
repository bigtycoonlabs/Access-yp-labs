-- 066: CUSTOMERS CAN CREATE THEIR OWN PORTAL ACCOUNT.
--
-- Owner decision, 16 Sept 2026. Each portal chooses how:
--   open      anyone can create an account once they confirm their email
--   approve   they can sign up and confirm, then the owner approves them before they get in
--   off       only customers the owner adds
-- The choice lives in the portal's config; this migration records who created each account and
-- where it stands.
--
-- AN ACCOUNT IS NOT REAL UNTIL ITS EMAIL IS CONFIRMED. Otherwise anybody could sign up as somebody
-- else and hold their address. An unconfirmed signup is invisible to the owner and never gets in.
--
-- Applied to production 16 Sept 2026. Verified there in a rolled-back function: an unconfirmed
-- self-made account set active, an owner-added account set pending and an unknown status were
-- refused; a confirmed active and an unconfirmed pending self-made account were accepted; existing
-- customers all stayed active.

ALTER TABLE yp_labs.portal_customers
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'owner',
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS approval_obligation_id uuid REFERENCES yp_labs.obligations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS signup_note text;

ALTER TABLE yp_labs.portal_customers DROP CONSTRAINT IF EXISTS portal_customer_source;
ALTER TABLE yp_labs.portal_customers ADD CONSTRAINT portal_customer_source CHECK (source IN ('owner', 'self'));
ALTER TABLE yp_labs.portal_customers DROP CONSTRAINT IF EXISTS portal_customer_status;
ALTER TABLE yp_labs.portal_customers ADD CONSTRAINT portal_customer_status CHECK (status IN ('active', 'pending', 'declined'));
-- Only a self-created account can be waiting or declined; the owner's own additions are active.
ALTER TABLE yp_labs.portal_customers DROP CONSTRAINT IF EXISTS owner_added_is_active;
ALTER TABLE yp_labs.portal_customers ADD CONSTRAINT owner_added_is_active CHECK (source = 'self' OR status = 'active');
-- A self-created account cannot be active until its email is confirmed.
ALTER TABLE yp_labs.portal_customers DROP CONSTRAINT IF EXISTS self_active_is_verified;
ALTER TABLE yp_labs.portal_customers ADD CONSTRAINT self_active_is_verified CHECK (
  source = 'owner' OR status <> 'active' OR verified_at IS NOT NULL);
ALTER TABLE yp_labs.portal_customers DROP CONSTRAINT IF EXISTS signup_note_short;
ALTER TABLE yp_labs.portal_customers ADD CONSTRAINT signup_note_short CHECK (signup_note IS NULL OR length(signup_note) <= 500);

-- For slowing a flood of signups from one place, without keeping the address itself.
CREATE TABLE IF NOT EXISTS yp_labs.portal_signup_attempts (
  portal_id   uuid NOT NULL REFERENCES yp_labs.portals(id) ON DELETE CASCADE,
  sender_hash text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_signup_attempts_idx
  ON yp_labs.portal_signup_attempts(portal_id, sender_hash, created_at DESC);
