-- 035: launch partners for projects that are NOT for sale.
--
-- Most people building anything are doing it alone, and being alone — not doubting the idea — is
-- what usually stops them. This lets a creator say out loud "I'm building this and I could use help
-- with X", and lets someone else raise their hand.
--
-- Deliberately NOT a social network and NOT a payment product:
--   * The unit posted is a PROJECT with a stated need, not a status update. There is no feed, no
--     follows, no comments — so there is very little to moderate.
--   * For a project that isn't listed for sale, the creator and the partner settle their own terms
--     privately. The platform introduces them and holds no part of the arrangement.
--   * Contact details are NEVER exposed by browsing. Someone expresses interest, the creator
--     decides, and only on acceptance are the two introduced to each other.

-- A creator saying: I'm building this, here's the help I want.
CREATE TABLE IF NOT EXISTS yp_labs.partner_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id   uuid NOT NULL REFERENCES yp_labs.concepts(id) ON DELETE CASCADE,
  owner_id     uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  needs        text[] NOT NULL DEFAULT '{}',   -- marketing, development, coaching, staffing, advice…
  summary      text NOT NULL,                  -- what they're building and what they actually need
  arrangement  text,                           -- how they'd like to work together, in their own words
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- One open ask per project: a creator can revise it, but can't spam the board with the same thing.
CREATE UNIQUE INDEX IF NOT EXISTS partner_requests_concept_key ON yp_labs.partner_requests (concept_id);
CREATE INDEX IF NOT EXISTS partner_requests_open_idx ON yp_labs.partner_requests (status, created_at DESC);

-- Someone raising their hand. The creator decides; nobody's contact details move before that.
CREATE TABLE IF NOT EXISTS yp_labs.partner_interest (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   uuid NOT NULL REFERENCES yp_labs.partner_requests(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  offer        text NOT NULL,                  -- what they're offering and how they'd like to work
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
-- One hand per person per project — no repeat pestering.
CREATE UNIQUE INDEX IF NOT EXISTS partner_interest_once_key ON yp_labs.partner_interest (request_id, user_id);
CREATE INDEX IF NOT EXISTS partner_interest_request_idx ON yp_labs.partner_interest (request_id, created_at DESC);
