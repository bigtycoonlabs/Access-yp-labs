-- 000: the rest of the schema drift — THIRTEEN tables production has that this repo cannot build.
--
-- How this was found: a database was built from scratch using only docs/schema.sql and every
-- migration in this folder, and then the app was actually USED against it. Four migrations failed
-- outright (001, 002, 022, 027) because they ALTER tables nothing ever creates, and the dashboard
-- broke section by section on missing columns. A full column-by-column diff against production then
-- showed 103 columns, across the tables below, that exist in the running system and nowhere in
-- version control.
--
-- Why it matters more than a tidy-up: the repository could not rebuild the platform. Restoring from
-- backup, standing up a staging copy, or onboarding a second environment would all have produced a
-- broken system, and nobody would have known until it failed. Definitions are copied from
-- production, so this is a no-op there and a repair everywhere else.
--
-- Everything is IF NOT EXISTS and additive: no data is touched, nothing is dropped.
--
-- Numbered 000 deliberately so it runs FIRST. Migrations 022 and 027 alter waitlist_signups and
-- clay_builds, which live here — if this ran last, a from-scratch build would still fail on those
-- two. Ordering is part of the fix, not an accident of naming.

-- Anonymous "sparks" — an idea typed on the homepage before anyone has an account.
CREATE TABLE IF NOT EXISTS yp_labs.anon_sparks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token      text NOT NULL,
  idea       text NOT NULL,
  title      text,
  angle      text,
  inside     jsonb,
  claimed_by uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS anon_sparks_token_idx ON yp_labs.anon_sparks (token, created_at DESC);

-- Checkout failures, kept so a payment problem can be diagnosed after the fact.
CREATE TABLE IF NOT EXISTS yp_labs.checkout_errors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  concept_id    uuid,
  plan          text,
  kind          text,
  message       text,
  stripe_code   text,
  stripe_param  text,
  stripe_type   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- A build in progress, and the audit trail of what Clay actually did.
CREATE TABLE IF NOT EXISTS yp_labs.clay_builds (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   uuid NOT NULL,
  concept_id uuid,
  status     text NOT NULL DEFAULT 'building',
  message    text,
  notes      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clay_builds_actor_idx ON yp_labs.clay_builds (actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS yp_labs.clay_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id           uuid,
  concept_id         uuid,
  kind               text NOT NULL DEFAULT 'generate',
  mode               text,
  category           text,
  result_status      text NOT NULL,
  reason             text,
  grounded           boolean NOT NULL DEFAULT false,
  source_count       integer NOT NULL DEFAULT 0,
  provider_available boolean,
  duration_ms        integer,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clay_runs_created_idx ON yp_labs.clay_runs (created_at DESC);

-- Every send attempt, including the failures. This is what makes "did it actually send?" answerable.
CREATE TABLE IF NOT EXISTS yp_labs.email_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email    text NOT NULL,
  kind        text NOT NULL,
  sent        boolean NOT NULL,
  provider_id text,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_log_created_idx ON yp_labs.email_log (created_at DESC);

-- Enterprise orchestration: one plan, many child projects built from it.
CREATE TABLE IF NOT EXISTS yp_labs.enterprise_plans (
  build_id          uuid PRIMARY KEY,
  owner_id          uuid NOT NULL,
  parent_concept_id uuid,
  title             text NOT NULL,
  thesis            text,
  status            text NOT NULL DEFAULT 'planning',
  child_count       integer NOT NULL DEFAULT 0,
  built_count       integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yp_labs.enterprise_build_steps (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id   uuid NOT NULL,
  owner_id   uuid NOT NULL,
  concept_id uuid,
  idx        integer NOT NULL,
  title      text NOT NULL,
  brief      text,
  category   text,
  status     text NOT NULL DEFAULT 'planned',
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS enterprise_steps_build_idx ON yp_labs.enterprise_build_steps (build_id, idx);

CREATE TABLE IF NOT EXISTS yp_labs.image_pack_purchases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid,
  concept_id        uuid,
  pack_id           text,
  images            integer NOT NULL,
  price_cents       integer NOT NULL,
  stripe_session_id text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Single-row schedule tables. The boolean primary key defaulting to true is the trick that keeps
-- them single-row: a second insert collides with the first.
CREATE TABLE IF NOT EXISTS yp_labs.seed_schedule (
  id              boolean PRIMARY KEY DEFAULT true,
  enabled         boolean NOT NULL DEFAULT false,
  daily_target    integer NOT NULL DEFAULT 2,
  min_gap_minutes integer NOT NULL DEFAULT 180,
  last_seed_at    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- The waitlist a creator collects on their own launch page.
CREATE TABLE IF NOT EXISTS yp_labs.waitlist_signups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id  uuid NOT NULL,
  email       text NOT NULL,
  name        text,
  ref_code    text NOT NULL,
  referred_by text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS waitlist_signups_concept_idx ON yp_labs.waitlist_signups (concept_id);

CREATE TABLE IF NOT EXISTS yp_labs.waitlist_launches (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id uuid NOT NULL,
  sender_id  uuid NOT NULL,
  subject    text NOT NULL,
  sent_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Columns on tables that DO exist here but were missing these fields.
ALTER TABLE yp_labs.users    ADD COLUMN IF NOT EXISTS billing_test boolean NOT NULL DEFAULT false;
ALTER TABLE yp_labs.users    ADD COLUMN IF NOT EXISTS pending_idea text;

ALTER TABLE yp_labs.concepts ADD COLUMN IF NOT EXISTS clays_take          text;
ALTER TABLE yp_labs.concepts ADD COLUMN IF NOT EXISTS expiry_reminded_at  timestamptz;
ALTER TABLE yp_labs.concepts ADD COLUMN IF NOT EXISTS last_opened_at      timestamptz NOT NULL DEFAULT now();
ALTER TABLE yp_labs.concepts ADD COLUMN IF NOT EXISTS next_steps          jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE yp_labs.concepts ADD COLUMN IF NOT EXISTS source_count        integer NOT NULL DEFAULT 0;

-- The embedding column needs pgvector, which Supabase installs in the `extensions` schema. Guarded
-- so a plain Postgres without the extension still builds a working database — retrieval degrades,
-- the platform runs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
              WHERE t.typname = 'vector') THEN
    EXECUTE 'ALTER TABLE yp_labs.concepts ADD COLUMN IF NOT EXISTS embedding vector(1536)';
  ELSE
    RAISE NOTICE 'pgvector not installed — concepts.embedding skipped. Semantic retrieval will be unavailable in this environment.';
  END IF;
END $$;
