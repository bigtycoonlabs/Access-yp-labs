-- NOTE: the ALTER statements below target project_files / payment_plans — tables from the housing
-- product this platform pivoted away from. They do not exist in production and nothing in src/
-- references them, so they are wrapped in a guard: skipped when the table is absent, still applied
-- if some old environment still has it. Without this, a database rebuilt from this repo fails here.
DO $mig$
BEGIN
  IF to_regclass('project_files') IS NOT NULL THEN
    ALTER TABLE project_files
      ADD COLUMN IF NOT EXISTS storage_public_id TEXT,
      ADD COLUMN IF NOT EXISTS storage_resource_type VARCHAR(50);
  END IF;
  IF to_regclass('payment_plans') IS NOT NULL THEN
    ALTER TABLE payment_plans
      ADD COLUMN IF NOT EXISTS stripe_checkout_session_id VARCHAR(255);
  END IF;
END $mig$;

CREATE TABLE IF NOT EXISTS stripe_events (
  id          VARCHAR(255) PRIMARY KEY,
  event_type  VARCHAR(255) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
