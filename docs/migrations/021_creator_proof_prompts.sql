-- 021: the weekly creator proof prompt.
--
-- Clay's own weekly review named this the highest-leverage move to grow creators: not more
-- motivation, but a small win they can finish. Once a week each creator gets one focused nudge —
-- one concept, one customer, one proof action a real stranger can act on — with a go-or-kill line
-- set in advance. This is our "proof is behavior, not compliments" value turned into a habit.
--
-- One row per creator per week (UNIQUE owner_id, week_start). week_start is the Monday of the week
-- (date_trunc('week', now())::date), so the same creator can't get two prompts in one week no matter
-- how many times the page loads or the scheduler fires.
CREATE TABLE IF NOT EXISTS yp_labs.creator_proof_prompts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES yp_labs.users(id)    ON DELETE CASCADE,
  concept_id  uuid NOT NULL REFERENCES yp_labs.concepts(id) ON DELETE CASCADE,
  week_start  date NOT NULL,
  focus       text NOT NULL,   -- the one customer to focus on
  action      text NOT NULL,   -- the one proof action to run
  go_kill     text NOT NULL,   -- what result means keep going, what means stop/rethink
  source      text NOT NULL DEFAULT 'template',
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','skipped')),
  emailed     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  acted_at    timestamptz,
  UNIQUE (owner_id, week_start)
);
CREATE INDEX IF NOT EXISTS creator_proof_prompts_owner_idx   ON yp_labs.creator_proof_prompts (owner_id, week_start DESC);
CREATE INDEX IF NOT EXISTS creator_proof_prompts_concept_idx ON yp_labs.creator_proof_prompts (concept_id, created_at DESC);

-- Single-row weekly cadence for the scheduler that generates + emails prompts, mirroring the other
-- schedulers. ON by default. The per-week UNIQUE above is the real guard; this just paces the batch.
CREATE TABLE IF NOT EXISTS yp_labs.proof_prompt_schedule (
  id              boolean PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  enabled         boolean NOT NULL DEFAULT TRUE,
  last_run_at     timestamptz,
  min_gap_minutes int NOT NULL DEFAULT 10080,   -- weekly
  updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO yp_labs.proof_prompt_schedule (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;
