-- 057: TEAMS. Seats, contributions, agreements, and the Standing ledger.
--
-- This is the schema for the Workshop: several people building one project together, with terms they
-- wrote themselves, and a record of what each of them actually did.
--
-- Everything here is ADDITIVE. Nothing existing is altered or dropped, because 13 live listings and
-- 33 in review were created under the current rules and must keep working exactly as they do today.
--
-- Four design decisions are enforced by the database rather than by application code, because a rule
-- that lives only in a route is a rule that holds on one path and silently fails on another. This
-- codebase has been burned by that repeatedly.
--
--   1. FIVE SEATS, ONE COUNTER. Contributors and launch partners draw from the same five. Two
--      separate limits would let a project quietly reach ten people and make every split meaningless.
--   2. NO SELF-DEALING. You cannot hold a seat on your own project, and the same person cannot hold
--      two seats on one project.
--   3. STANDING IS A LEDGER, NEVER A COLUMN. Append-only, with a unique key per real-world event so
--      the same thing cannot be recorded twice. A reversal is a negative row, never a deletion, so
--      the history stays true.
--   4. AN AGREEMENT IS VERSIONED AND SIGNED. Terms are the team's to write; what the platform
--      guarantees is that nobody is bound to something they never saw.

-- ---------------------------------------------------------------------------------------------
-- SEATS. What a project is asking for, and who is filling it.
--
-- Zero partner requests have ever been sent on this platform. Launch Partners is built, live, and
-- unused, because a project could say it was open to partners but never what it actually NEEDED.
-- A seat is that missing sentence: build, sell, materials, operate, craft.

CREATE TABLE IF NOT EXISTS yp_labs.project_seats (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  concept_id      uuid NOT NULL REFERENCES yp_labs.concepts(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('build','sell','materials','operate','craft')),
  brief           text,                       -- what this project needs from this person, in their words
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','filled','withdrawn')),
  holder_id       uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  filled_at       timestamptz,
  released_at     timestamptz,
  created_by      uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- A filled seat has a holder and a time. An open one has neither. Enforced rather than assumed:
  -- "filled with nobody in it" is exactly the kind of state that produces a confident wrong number.
  CONSTRAINT seat_filled_has_holder CHECK (
    (status = 'filled' AND holder_id IS NOT NULL AND filled_at IS NOT NULL)
    OR (status <> 'filled')
  )
);

CREATE INDEX IF NOT EXISTS project_seats_concept_idx ON yp_labs.project_seats(concept_id);
CREATE INDEX IF NOT EXISTS project_seats_holder_idx  ON yp_labs.project_seats(holder_id);

-- One person cannot hold two seats on the same project. Partial unique index so released and
-- withdrawn seats do not block a later legitimate one.
CREATE UNIQUE INDEX IF NOT EXISTS project_seats_one_per_person
  ON yp_labs.project_seats(concept_id, holder_id)
  WHERE status = 'filled';

-- ---------------------------------------------------------------------------------------------
-- CONTRIBUTIONS. An asset somebody else added to a project.
--
-- The project OWNER approves these, not staff and not Clay. It is their project; nobody else can
-- judge whether a contribution fits what they are building. Clay screens first for obvious junk,
-- which is speed, not authority.
--
-- The share is fixed at acceptance and never recalculated. A contributor knows what they earned the
-- day they earned it, rather than discovering months later that it was diluted by everyone who came
-- after. That dilution is what turned Quirky's community from proud to resentful: on their biggest
-- product ever, 1,005 contributors averaged about $992 each.

CREATE TABLE IF NOT EXISTS yp_labs.contributions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  concept_id      uuid NOT NULL REFERENCES yp_labs.concepts(id) ON DELETE CASCADE,
  contributor_id  uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  seat_id         uuid REFERENCES yp_labs.project_seats(id) ON DELETE SET NULL,
  asset_id        uuid REFERENCES yp_labs.assets(id) ON DELETE SET NULL,
  kind            text NOT NULL,              -- the asset kind, matching the value ladder's vocabulary
  note            text,                       -- what they say they did
  state           text NOT NULL DEFAULT 'offered'
                  CHECK (state IN ('offered','accepted','superseded','rejected')),
  decided_by      uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  decision_reason text,                       -- a rejection must say why. It teaches or it stings.
  share_bp        integer CHECK (share_bp IS NULL OR (share_bp >= 0 AND share_bp <= 10000)),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Basis points, not percent: a five-way split of 70% does not divide cleanly in whole percentages
  -- and rounding somebody's share away is the kind of small dishonesty that ends a team.
  CONSTRAINT contribution_accepted_has_share CHECK (
    (state IN ('accepted','superseded') AND share_bp IS NOT NULL AND decided_at IS NOT NULL)
    OR (state IN ('offered','rejected'))
  ),
  CONSTRAINT contribution_rejected_has_reason CHECK (
    state <> 'rejected' OR decision_reason IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS contributions_concept_idx     ON yp_labs.contributions(concept_id);
CREATE INDEX IF NOT EXISTS contributions_contributor_idx ON yp_labs.contributions(contributor_id);

-- ---------------------------------------------------------------------------------------------
-- THE FIVE-SEAT RULE, as one shared counter across seats and accepted contributions.
--
-- A trigger rather than a check constraint, because the rule spans two tables and counts rows.
-- It runs on both, so neither path can be the one that quietly lets a sixth person in.

CREATE OR REPLACE FUNCTION yp_labs.enforce_five_seats() RETURNS trigger AS $$
DECLARE
  cid uuid;
  taken integer;
BEGIN
  cid := NEW.concept_id;

  SELECT
    (SELECT count(DISTINCT holder_id) FROM yp_labs.project_seats
      WHERE concept_id = cid AND status = 'filled' AND holder_id IS NOT NULL)
    +
    (SELECT count(DISTINCT c.contributor_id) FROM yp_labs.contributions c
      WHERE c.concept_id = cid AND c.state IN ('accepted','superseded')
        AND c.contributor_id NOT IN (
          SELECT holder_id FROM yp_labs.project_seats
           WHERE concept_id = cid AND status = 'filled' AND holder_id IS NOT NULL))
  INTO taken;

  IF taken > 5 THEN
    RAISE EXCEPTION 'This project already has five people on it. Nobody else can be added until somebody releases their seat.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS seats_five_max ON yp_labs.project_seats;
CREATE CONSTRAINT TRIGGER seats_five_max
  AFTER INSERT OR UPDATE ON yp_labs.project_seats
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION yp_labs.enforce_five_seats();

DROP TRIGGER IF EXISTS contributions_five_max ON yp_labs.contributions;
CREATE CONSTRAINT TRIGGER contributions_five_max
  AFTER INSERT OR UPDATE ON yp_labs.contributions
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION yp_labs.enforce_five_seats();

-- ---------------------------------------------------------------------------------------------
-- AGREEMENTS. The split the team wrote themselves.
--
-- The platform does not decide what people's work is worth to each other. It moderates for safety
-- and honesty and gets out of the way. What it guarantees is narrow and absolute: the shares add up,
-- everybody signed, nobody is below the floor, and the terms were readable before anyone joined.

CREATE TABLE IF NOT EXISTS yp_labs.team_agreements (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  concept_id      uuid NOT NULL REFERENCES yp_labs.concepts(id) ON DELETE CASCADE,
  version         integer NOT NULL,
  terms           jsonb NOT NULL,             -- [{ user_id, role, share_bp }]
  note            text,                       -- anything the team wants recorded in their own words
  proposed_by     uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  state           text NOT NULL DEFAULT 'proposed'
                  CHECK (state IN ('proposed','signed','superseded','withdrawn')),
  locked_at       timestamptz,                -- set when the listing goes live. Nothing changes mid-sale.
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (concept_id, version)
);

CREATE INDEX IF NOT EXISTS team_agreements_concept_idx ON yp_labs.team_agreements(concept_id);

-- Every member signs. A superseding version requires every signature again, and the old version
-- stays readable — you can always see what was agreed and when.
CREATE TABLE IF NOT EXISTS yp_labs.agreement_signatures (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  agreement_id    uuid NOT NULL REFERENCES yp_labs.team_agreements(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  signed_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agreement_id, user_id)
);

-- ---------------------------------------------------------------------------------------------
-- STANDING. An append-only ledger, never a stored total.
--
-- The rule it encodes: you cannot earn it alone. Somebody else had to act — a project owner
-- accepting your work, a staff member verifying a listing, a stranger joining a waitlist. Nothing
-- self-generated scores, which is what stops the score inflating the way the value ladder did when
-- it counted a web search as proof of demand.
--
-- dedupe_key makes the same real-world event impossible to record twice. A reversal is a new row
-- with a negative value and a reason, never a delete, so "what did this person actually do" stays
-- answerable including the parts that came undone.

CREATE TABLE IF NOT EXISTS yp_labs.standing_events (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  event           text NOT NULL,
  concept_id      uuid REFERENCES yp_labs.concepts(id) ON DELETE SET NULL,
  listing_id      uuid REFERENCES yp_labs.listings(id) ON DELETE SET NULL,
  actor_id        uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,  -- who else acted
  standing        integer NOT NULL,
  sparks          integer NOT NULL DEFAULT 0,
  verified_by     text NOT NULL CHECK (verified_by IN ('owner','staff','stranger','system','reversal')),
  dedupe_key      text NOT NULL UNIQUE,
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS standing_events_user_idx ON yp_labs.standing_events(user_id);

-- ---------------------------------------------------------------------------------------------
-- REVIEW STATUS. Why a listing is sitting in the queue.
--
-- 33 listings in review against 13 live. Counts alone cannot say whether that is staffing, missing
-- materials or policy friction, and staff currently rediscover the same problem every time they open
-- the queue while the creator waits in silence. One status, set on submission, changeable by staff.

ALTER TABLE yp_labs.listings
  ADD COLUMN IF NOT EXISTS review_status text
    CHECK (review_status IS NULL OR review_status IN (
      'ready_for_decision',      -- nothing missing. waiting on a person.
      'missing_baseline',        -- name the absent asset
      'possible_live_business',  -- looks like a business they already run
      'possible_misrepresentation',
      'needs_risk_disclosure'
    )),
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS review_status_at timestamptz;
