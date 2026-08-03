-- 016_seed_runs.sql
-- Persistent observability for Clay's seeding pipeline.
--
-- Until now, every seed attempt (manual or scheduled) only logged to the server console. When a
-- seed failed to produce a concept, it left no trace a human could see: last_seed_at advanced, the
-- shelf stayed empty, and the reason vanished into Railway logs. This table records the outcome of
-- EVERY seed attempt so staff can see exactly why a seed did or did not produce a concept — without
-- reading server logs.
--
-- Pure audit log: append-only, no foreign keys (a run record must survive even if its concept is
-- later removed), and writing it never affects a seed's result.

CREATE TABLE IF NOT EXISTS yp_labs.seed_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text NOT NULL DEFAULT 'manual',   -- 'manual' (staff-triggered) | 'scheduled' (auto)
  ok          boolean NOT NULL,                  -- did the attempt produce a listable seed?
  reason      text,                              -- 'seeded' on success; else the failure reason
                                                 -- (e.g. no_novel_idea, build_empty, no_baseline, error)
  concept_id  uuid,                              -- set if a concept row was created
  listing_id  uuid,                              -- set if a listing (in_review) was created
  title       text,
  emailed     boolean,                           -- success path: did the staff-review email send?
  detail      text,                              -- error detail, when reason='error'
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seed_runs_created ON yp_labs.seed_runs (created_at DESC);
