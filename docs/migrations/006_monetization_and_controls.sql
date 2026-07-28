-- 006: Maker/Sculptor plans, concept access window + origin + working-since,
-- asset versioning + scan status + lock time, reports, moderation_events.
-- (Applied to yp_labs via Supabase apply_migration.)
ALTER TABLE yp_labs.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE yp_labs.subscriptions ADD CONSTRAINT subscriptions_plan_check CHECK (plan IN ('maker','sculptor'));
ALTER TABLE yp_labs.subscriptions ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE yp_labs.subscriptions ADD COLUMN IF NOT EXISTS current_period_end timestamptz;
ALTER TABLE yp_labs.subscriptions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE yp_labs.concepts ADD COLUMN IF NOT EXISTS access_expires_at timestamptz;
ALTER TABLE yp_labs.concepts ALTER COLUMN access_expires_at SET DEFAULT (now() + interval '30 days');
ALTER TABLE yp_labs.concepts ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'created' CHECK (origin IN ('created','purchased'));
ALTER TABLE yp_labs.concepts ADD COLUMN IF NOT EXISTS working_since date;
ALTER TABLE yp_labs.concepts ADD COLUMN IF NOT EXISTS show_working_since boolean NOT NULL DEFAULT false;

ALTER TABLE yp_labs.assets ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE yp_labs.assets ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true;
ALTER TABLE yp_labs.assets ADD COLUMN IF NOT EXISTS scan_status text NOT NULL DEFAULT 'not_required' CHECK (scan_status IN ('not_required','pending','clean','flagged'));
ALTER TABLE yp_labs.assets ADD COLUMN IF NOT EXISTS scan_detail text;
ALTER TABLE yp_labs.assets ADD COLUMN IF NOT EXISTS locked_at timestamptz;

CREATE TABLE IF NOT EXISTS yp_labs.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  target_type text NOT NULL CHECK (target_type IN ('listing','concept','user','review')),
  target_id uuid NOT NULL, reason text NOT NULL, details text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS yp_labs.moderation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moderator_id uuid NOT NULL REFERENCES yp_labs.users(id),
  target_type text NOT NULL CHECK (target_type IN ('listing','concept','user','review','report')),
  target_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('suspend_user','reinstate_user','takedown_listing','remove_concept','remove_review','dismiss_report','note')),
  reason text, notes text, created_at timestamptz NOT NULL DEFAULT now());
