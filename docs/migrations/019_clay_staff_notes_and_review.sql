-- 019: Clay can reach the team, and reviews the platform for them once a week.
--
-- clay_staff_notes — an append-only log of every message Clay sends the team (a concern he has, an
-- idea to improve the platform, or his weekly review). Truth over silence: the outreach is recorded
-- whether or not the email actually delivered, so nothing Clay "said to the team" is invisible.
CREATE TABLE IF NOT EXISTS yp_labs.clay_staff_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL DEFAULT 'note',
  subject      text,
  body         text,
  dedupe_key   text,
  recipients   int  NOT NULL DEFAULT 0,
  emailed      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clay_staff_notes_created_idx ON yp_labs.clay_staff_notes (created_at DESC);
CREATE INDEX IF NOT EXISTS clay_staff_notes_dedupe_idx  ON yp_labs.clay_staff_notes (dedupe_key, created_at DESC);

-- clay_review_schedule — single-row cadence for Clay's weekly self-and-platform review, mirroring
-- seed_schedule's atomic-claim design. ON by default: the review only emails the team and logs; it
-- never changes anything on its own, so it is safe to run unattended. Weekly gap (10080 minutes).
CREATE TABLE IF NOT EXISTS yp_labs.clay_review_schedule (
  id              boolean PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  enabled         boolean NOT NULL DEFAULT TRUE,
  last_run_at     timestamptz,
  min_gap_minutes int NOT NULL DEFAULT 10080,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO yp_labs.clay_review_schedule (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;
