-- 039: record the dreamer tag column that production already has but no migration ever created.
--
-- Found by building a database from this repo from scratch: users.display_name exists in production
-- and is read by seven route files — it is the DREAMER TAG, the public identity on listings, the
-- launch partner board and the Dream Mover page — but nothing in docs/ ever created it. So the repo
-- could not rebuild the live schema, and a fresh environment would have started throwing on any
-- query that touched it. This is drift being written down, not a change of behaviour: on production
-- both columns already exist and IF NOT EXISTS makes this a no-op there.
--
-- open_to_partnering is included for the same reason: migration 036 added it, but only after some
-- environments already had it, so this keeps a from-scratch build honest.

ALTER TABLE yp_labs.users ADD COLUMN IF NOT EXISTS display_name       text;
ALTER TABLE yp_labs.users ADD COLUMN IF NOT EXISTS open_to_partnering boolean NOT NULL DEFAULT false;

-- One dreamer tag per person: two creators cannot be known by the same name. Partial, so the many
-- accounts that have not chosen one yet are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS users_display_name_key
  ON yp_labs.users (lower(display_name))
  WHERE display_name IS NOT NULL AND display_name <> '';
