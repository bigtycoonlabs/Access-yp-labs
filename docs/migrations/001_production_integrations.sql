ALTER TABLE project_files
  ADD COLUMN IF NOT EXISTS storage_public_id TEXT,
  ADD COLUMN IF NOT EXISTS storage_resource_type VARCHAR(50);

ALTER TABLE payment_plans
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id VARCHAR(255);

CREATE TABLE IF NOT EXISTS stripe_events (
  id          VARCHAR(255) PRIMARY KEY,
  event_type  VARCHAR(255) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
