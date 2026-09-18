-- 077: WORK THAT HAPPENS WITHOUT BEING ASKED (owner, 17 September 2026).
--
-- "Doing things on a schedule, and telling me when she is done, is absolutely something she needs to
-- be able to do." With one rule set by the owner in the same breath: anything that spends money,
-- could break something, or needs a human decision, she does NOT do on her own.
--
-- So a standing job is an instruction in the owner's own words, run on a cadence. Every run is
-- recorded with what was actually done, including the runs that stopped because they reached
-- something needing a person. A schedule nobody can audit is worse than no schedule.
CREATE TABLE IF NOT EXISTS yp_labs.standing_jobs (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  business_id uuid REFERENCES yp_labs.businesses(id) ON DELETE CASCADE,
  asked_for text NOT NULL CHECK (length(btrim(asked_for)) BETWEEN 3 AND 600),
  cadence text NOT NULL CHECK (cadence IN ('daily', 'weekdays', 'weekly', 'monthly')),
  -- Local hour the person chose, and the zone it means. 9 in Austin is not 9 in London.
  at_hour int NOT NULL DEFAULT 8 CHECK (at_hour BETWEEN 0 AND 23),
  weekday int CHECK (weekday BETWEEN 0 AND 6),
  day_of_month int CHECK (day_of_month BETWEEN 1 AND 28),
  timezone text NOT NULL DEFAULT 'America/Chicago',
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  stopped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS standing_jobs_due_idx ON yp_labs.standing_jobs (next_run_at) WHERE active;

CREATE TABLE IF NOT EXISTS yp_labs.standing_runs (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  job_id uuid NOT NULL REFERENCES yp_labs.standing_jobs(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  -- 'done' finished it; 'needs_you' reached something only a person may decide; 'failed' could not.
  status text CHECK (status IN ('running', 'done', 'needs_you', 'failed')),
  summary text,
  tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  told_them boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS standing_runs_job_idx ON yp_labs.standing_runs (job_id, started_at DESC);
