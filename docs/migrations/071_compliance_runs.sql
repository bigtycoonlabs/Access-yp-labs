-- 071: COMPLIANCE RUNS. Research takes minutes, so it runs in the background like a build.
--
-- Measured 16 Sept 2026: one area took two to five minutes at high reasoning, and a full picture of
-- eight took over six, far past a chat turn. Penny starts a run and says so; the results land in
-- compliance_research, and the run records how it ended in words.

CREATE TABLE IF NOT EXISTS yp_labs.compliance_runs (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   uuid NOT NULL REFERENCES yp_labs.businesses(id) ON DELETE CASCADE,
  areas         text[] NOT NULL DEFAULT '{}',
  question      text CHECK (question IS NULL OR length(question) BETWEEN 3 AND 600),
  fresh         boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  says          text,
  requested_by  uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  CONSTRAINT something_to_research CHECK (question IS NOT NULL OR cardinality(areas) > 0),
  CONSTRAINT finished_says_how CHECK (status NOT IN ('done', 'failed') OR (finished_at IS NOT NULL AND says IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS compliance_runs_business_idx ON yp_labs.compliance_runs(business_id, created_at DESC);
