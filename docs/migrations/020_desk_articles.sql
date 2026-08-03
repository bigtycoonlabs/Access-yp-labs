-- 020: Clay's Desk pieces — his help articles and witty stories.
--
-- Clay drafts these; a human owner decides what the public sees. NOTHING is ever published
-- automatically — the same discipline Arbo's daily Desk holds ("filed for approval, never
-- auto-published"). A piece starts as 'draft', an owner moves it to 'published' or 'archived'.
CREATE TABLE IF NOT EXISTS yp_labs.desk_articles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL DEFAULT 'help'   CHECK (kind IN ('help','story')),
  title        text NOT NULL,
  dek          text,                          -- one-line teaser shown under the title
  body         text NOT NULL,
  topic        text,                           -- what it's about (for Clay's own variety)
  status       text NOT NULL DEFAULT 'draft'  CHECK (status IN ('draft','published','archived')),
  source       text NOT NULL DEFAULT 'clay',
  approved_by  uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX IF NOT EXISTS desk_articles_status_idx    ON yp_labs.desk_articles (status, published_at DESC);
CREATE INDEX IF NOT EXISTS desk_articles_created_idx    ON yp_labs.desk_articles (created_at DESC);

-- desk_compose_schedule — single-row gentle cadence for Clay drafting new Desk pieces, mirroring
-- clay_review_schedule. It only ever creates DRAFTS (filed for approval), and only when the pending
-- draft queue is small, so it can never flood the queue or the public page. ON by default, ~3 days.
CREATE TABLE IF NOT EXISTS yp_labs.desk_compose_schedule (
  id              boolean PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  enabled         boolean NOT NULL DEFAULT TRUE,
  last_run_at     timestamptz,
  min_gap_minutes int NOT NULL DEFAULT 4320,   -- ~3 days
  max_pending     int NOT NULL DEFAULT 3,        -- don't draft more if this many are already waiting
  updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO yp_labs.desk_compose_schedule (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;
