-- When we sent the one "here is your next step" message for this project. One per project, ever —
-- the point is to be useful once, not to become the thing someone filters.
ALTER TABLE yp_labs.concepts ADD COLUMN IF NOT EXISTS nudged_at timestamptz;
