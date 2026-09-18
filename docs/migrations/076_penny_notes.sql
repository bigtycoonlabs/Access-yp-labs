-- 076: WHAT PENNY HAS BEEN TOLD (owner, 17 September 2026).
--
-- "Tell her how you want to work, tell her about your business, she does whatever you need." Until
-- now she started every conversation knowing only the records; anything a person explained about how
-- they like things done was gone by the next turn, so they had to say it again. This is where that
-- is kept.
--
-- Only what the PERSON said. Never an inference she drew about them: a note in here is read back as
-- fact in every later conversation, and a guess read back as fact is how somebody ends up arguing
-- with their own assistant about their own business.
CREATE TABLE IF NOT EXISTS yp_labs.penny_notes (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  -- Null means it is about the person and how they work, and applies everywhere.
  business_id uuid REFERENCES yp_labs.businesses(id) ON DELETE CASCADE,
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 600),
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);
CREATE INDEX IF NOT EXISTS penny_notes_user_idx ON yp_labs.penny_notes (user_id) WHERE removed_at IS NULL;
