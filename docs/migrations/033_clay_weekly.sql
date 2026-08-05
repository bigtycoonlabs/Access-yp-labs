-- 033: Clay Weekly — the platform's magazine, plus the two things it needs to exist safely:
-- a sponsorship offer a creator can actually accept or decline, and a real email opt-out.
--
-- Nothing here publishes or sends on its own. Clay assembles an issue as a DRAFT; an owner approves
-- it; only then can it be published and sent. That mirrors how the Desk already works.

-- An issue of Clay Weekly.
CREATE TABLE IF NOT EXISTS yp_labs.weekly_issues (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text UNIQUE,                 -- its public address, /weekly/<slug>
  week_start           date NOT NULL,               -- the Monday this issue covers
  title                text NOT NULL,
  intro                text,                        -- Clay's opening line for the issue
  clays_note           text,                        -- "Clay's Note": his personal piece
  sponsored_concept_id uuid REFERENCES yp_labs.concepts(id) ON DELETE SET NULL,
  sponsored_blurb      text,                        -- why Clay chose it, in his words
  highlights           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- creators/movers shout-outs, article ids
  status               text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','approved','published','archived')),
  approved_by          uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  published_at         timestamptz,
  sent_at              timestamptz,                 -- when the email actually went out
  recipients_count     integer NOT NULL DEFAULT 0   -- how many it actually reached (honest count)
);
CREATE UNIQUE INDEX IF NOT EXISTS weekly_issues_week_key ON yp_labs.weekly_issues (week_start);
CREATE INDEX IF NOT EXISTS weekly_issues_status_idx ON yp_labs.weekly_issues (status, published_at DESC);

-- A sponsorship OFFER: Clay picks a project, an owner approves the ask, the creator says yes or no.
-- Nobody is featured as "sponsored" without saying yes first.
CREATE TABLE IF NOT EXISTS yp_labs.weekly_sponsorships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id   uuid NOT NULL REFERENCES yp_labs.concepts(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  issue_id     uuid REFERENCES yp_labs.weekly_issues(id) ON DELETE SET NULL,
  token        text NOT NULL UNIQUE,                -- what the accept/decline link carries
  reason       text,                                 -- why Clay chose it
  status       text NOT NULL DEFAULT 'offered'
               CHECK (status IN ('offered','accepted','declined','expired')),
  offered_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);
CREATE INDEX IF NOT EXISTS weekly_sponsorships_status_idx ON yp_labs.weekly_sponsorships (status, offered_at DESC);
CREATE INDEX IF NOT EXISTS weekly_sponsorships_concept_idx ON yp_labs.weekly_sponsorships (concept_id);

-- Email preferences. A person must be able to stop receiving the magazine without losing their
-- account or their transactional mail (receipts, password resets — those are NOT marketing and are
-- never governed by this flag). Every account gets a stable unsubscribe token.
CREATE TABLE IF NOT EXISTS yp_labs.user_email_prefs (
  user_id    uuid PRIMARY KEY REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  weekly     boolean NOT NULL DEFAULT true,
  token      text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(18), 'hex'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Everyone who already has an account starts opted IN to the magazine (they can leave in one click
-- from every issue), with a token generated for them.
INSERT INTO yp_labs.user_email_prefs (user_id)
SELECT id FROM yp_labs.users
ON CONFLICT (user_id) DO NOTHING;
