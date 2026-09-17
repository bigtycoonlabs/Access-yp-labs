-- 074: ALLOWANCES AND TOP-UPS. The monthly allowances on the plans page, enforced (owner's plans,
-- 16 September 2026). Usage is counted when work actually happens: a Penny reply, a finished build, a
-- compliance search that ran. Beyond the month's allowance, work draws on top-up units, which last
-- until used. Retired plans and staff are never limited.
CREATE TABLE IF NOT EXISTS yp_labs.usage_events (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('penny_message', 'build', 'compliance_review', 'compliance_question')),
  from_topup  boolean NOT NULL DEFAULT false,
  ref         text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_events_month_idx ON yp_labs.usage_events (user_id, kind, created_at);

CREATE TABLE IF NOT EXISTS yp_labs.topup_balances (
  user_id     uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('penny_message', 'build', 'compliance_question')),
  units       integer NOT NULL DEFAULT 0 CHECK (units >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE IF NOT EXISTS yp_labs.topup_purchases (
  id                 bigserial PRIMARY KEY,
  stripe_session_id  text NOT NULL UNIQUE,
  user_id            uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('penny_message', 'build', 'compliance_question')),
  units              integer NOT NULL CHECK (units > 0),
  price_cents        integer NOT NULL CHECK (price_cents >= 0),
  created_at         timestamptz NOT NULL DEFAULT now()
);
