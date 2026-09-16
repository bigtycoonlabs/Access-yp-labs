-- 068: LAUNCHES. Taking a finished custom web application out of the preview and onto the client's
-- own accounts, one confirmed step at a time.
--
-- A build is not a live site until it is hosted outside our sandbox (owner, 16 Sept 2026). A launch
-- records each step separately, because each creates something in the client's account, each needs
-- its own yes, and each can fail on its own. A step is only "done" with something to show for it: a
-- repository address, a project id, a live address.
--
-- Applied to production 16 Sept 2026 and verified there in a rolled-back function: a repository name
-- with spaces and slashes, a step marked done with nothing to show, and an unknown step were refused;
-- a valid name, a check step done with its address, and a failed hosting step were accepted.

CREATE TABLE IF NOT EXISTS yp_labs.launches (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  build_id      uuid NOT NULL REFERENCES yp_labs.builds(id) ON DELETE CASCADE,
  business_id   uuid NOT NULL REFERENCES yp_labs.businesses(id) ON DELETE CASCADE,
  started_by    uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  repo_name     text CHECK (repo_name IS NULL OR repo_name ~ '^[A-Za-z0-9._-]{1,100}$'),
  repo_url      text,
  railway_project_id text,
  railway_service_id text,
  live_url      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS launches_build_idx ON yp_labs.launches(build_id, created_at DESC);

CREATE TABLE IF NOT EXISTS yp_labs.launch_steps (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  launch_id   uuid NOT NULL REFERENCES yp_labs.launches(id) ON DELETE CASCADE,
  step        text NOT NULL CHECK (step IN ('code', 'hosting', 'check')),
  status      text NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  says        text NOT NULL,
  result      text,
  confirmed_by uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  -- Done means there is something to show for it.
  CONSTRAINT done_has_result CHECK (status <> 'done' OR (result IS NOT NULL AND finished_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS launch_steps_launch_idx ON yp_labs.launch_steps(launch_id, created_at);
