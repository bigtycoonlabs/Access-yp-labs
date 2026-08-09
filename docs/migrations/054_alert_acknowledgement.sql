-- AN ALERT NOBODY CAN CLOSE IS AN ALERT NOBODY READS.
--
-- The platform raises real operational alarms — a seller still being billed for a project they sold,
-- a payment that may be applied twice, a reset email that never sent. They land in a list that only
-- ever grows. Within a week the console showed nine, most of them from testing, with no way to say
-- "handled" — so the genuinely urgent ones sit among noise, and the list becomes something you scroll
-- past. That is how an alerting system dies: not switched off, just ignored.
--
-- Three states, because two is not enough. SEEN is not the same as FIXED: acknowledging says
-- somebody is on it, resolving says it is done. Without the middle state, an alert somebody is
-- actively working on looks identical to one nobody has touched.
ALTER TABLE yp_labs.clay_staff_notes ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
ALTER TABLE yp_labs.clay_staff_notes ADD COLUMN IF NOT EXISTS acknowledged_by uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL;
ALTER TABLE yp_labs.clay_staff_notes ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE yp_labs.clay_staff_notes ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL;
-- What was actually done about it. The most valuable field here: an alert resolved with "restarted
-- the worker" teaches the next person something; one resolved silently teaches nothing.
ALTER TABLE yp_labs.clay_staff_notes ADD COLUMN IF NOT EXISTS resolution_note text;

CREATE INDEX IF NOT EXISTS clay_staff_notes_open_idx
  ON yp_labs.clay_staff_notes (created_at DESC) WHERE resolved_at IS NULL;
