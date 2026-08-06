-- 040: three more columns that production has but no migration ever created.
--
-- Found the same way as 039 — by building this schema from scratch and then USING the app against
-- it. Three sections of the dashboard immediately failed: Today's Dreams, the Movement board, and
-- Dream Market tuning. Each is read by live code and exists in production, but nothing in docs/
-- created them, so the repo could not rebuild the running system and a fresh environment was broken
-- on arrival.
--
-- Definitions copied from production, so this is a no-op there and a repair everywhere else.

ALTER TABLE yp_labs.concepts
  ADD COLUMN IF NOT EXISTS research_grounded boolean NOT NULL DEFAULT false;
ALTER TABLE yp_labs.concepts
  ADD COLUMN IF NOT EXISTS expired_at timestamptz;

ALTER TABLE yp_labs.user_preferences
  ADD COLUMN IF NOT EXISTS reminders_muted boolean NOT NULL DEFAULT false;

-- Read by the Today's Dreams feed. Nullable with no default in production, which is meaningful:
-- null means nobody has checked the claims yet, false means they were checked and did not hold up.
-- Copied exactly rather than tidied, so the repo matches what is actually running.
ALTER TABLE yp_labs.concepts
  ADD COLUMN IF NOT EXISTS claims_verified boolean;
