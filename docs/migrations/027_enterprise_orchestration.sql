-- 027_enterprise_orchestration.sql
-- Enterprise builds: a parent "enterprise" concept that OWNS child concepts, built by Clay as an
-- orchestrated set of bounded jobs — PLAN the ventures (one small, fast call), BUILD each venture
-- as its own normal-sized concept, then ASSEMBLE the parent overview. This lets a whole
-- multi-venture company be created without one oversized generation call timing out (the failure
-- mode we saw: a single pass over a 3-platform holding company ran ~3m41s and gave up rather than
-- fabricate). Everything here is additive and safe.
--
-- The child -> parent link REUSES the existing self-referential concepts.parent_id (until now only
-- an optional field on manual concept creation, with no other behavior), so no new relationship is
-- invented. Because both the parent and its children are ordinary concepts, they inherit every
-- existing capability for free: a creator can keep them all, list one child to sell a single
-- venture, or list the parent to sell the whole business. We add one explicit flag to mark a
-- concept as an enterprise parent, plus two small tables so an enterprise build's plan and its
-- per-venture progress are always tracked truthfully — one venture failing never loses the others.

-- Mark a concept as an enterprise parent (a holding company that owns child concepts via parent_id).
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS is_enterprise boolean NOT NULL DEFAULT false;

-- Fast child lookups by parent.
CREATE INDEX IF NOT EXISTS concepts_parent_id_idx ON concepts(parent_id);

-- One row per enterprise build: the plan header the runner remembers between planning and assembly,
-- and the honest running tally of how many ventures were actually built.
CREATE TABLE IF NOT EXISTS enterprise_plans (
  build_id          uuid PRIMARY KEY REFERENCES clay_builds(id) ON DELETE CASCADE,
  owner_id          uuid NOT NULL,
  title             text NOT NULL,
  thesis            text,
  status            text NOT NULL DEFAULT 'planning',  -- planning | building | assembling | done | failed
  parent_concept_id uuid REFERENCES concepts(id) ON DELETE SET NULL,
  child_count       integer NOT NULL DEFAULT 0,
  built_count       integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- One row per planned child venture in an enterprise build — its own bounded job, tracked so a
-- failure on one venture never loses the others and progress stays truthful.
CREATE TABLE IF NOT EXISTS enterprise_build_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id    uuid NOT NULL REFERENCES clay_builds(id) ON DELETE CASCADE,
  owner_id    uuid NOT NULL,
  idx         integer NOT NULL,
  title       text NOT NULL,
  brief       text,
  category    text,
  status      text NOT NULL DEFAULT 'planned',  -- planned | building | done | failed
  concept_id  uuid REFERENCES concepts(id) ON DELETE SET NULL,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS enterprise_build_steps_build_idx ON enterprise_build_steps(build_id);
