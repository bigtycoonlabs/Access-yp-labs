-- 067: KEYS. The secrets a business lets Penny use: GitHub, Railway and Supabase, for now.
--
-- Owner direction, 16 Sept 2026: a controlled area where the person or Penny stores tokens, keys are
-- never left in the chat, and rotation is suggested. Name "Keys" and a 90-day rotation are the
-- proposals from the go-live plan, used until the owner chooses otherwise.
--
-- A KEY IS NEVER READABLE BACK. The value is encrypted with AES-256-GCM under a master key that lives
-- only in the service's environment, never in this database, so a copy of the database alone opens
-- nothing. No screen, route or Penny tool returns the value: only the last four characters, what it
-- was checked to reach, and when it was last used.
--
-- EVERY USE IS WRITTEN DOWN, with who asked and whether it was Penny.
--
-- Applied to production 16 Sept 2026, with KEYS_MASTER_KEY set on the Railway service. Verified there
-- in a rolled-back function: a second live key for the same service, a key removed without being
-- wiped, an unknown service and a short nonce were refused; a well-formed key, a removed and wiped key,
-- and granting the keys permission area were accepted.

CREATE TABLE IF NOT EXISTS yp_labs.business_keys (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   uuid NOT NULL REFERENCES yp_labs.businesses(id) ON DELETE CASCADE,
  service       text NOT NULL CHECK (service IN ('github', 'railway', 'supabase')),
  label         text CHECK (label IS NULL OR length(label) <= 80),
  ciphertext    bytea NOT NULL,
  iv            bytea NOT NULL CHECK (length(iv) = 12),
  tag           bytea NOT NULL CHECK (length(tag) = 16),
  key_version   smallint NOT NULL DEFAULT 1,
  last4         text NOT NULL CHECK (length(last4) = 4),
  -- What the save-time check found: who it acts as, what kind of token, what it can reach.
  checked       jsonb NOT NULL DEFAULT '{}'::jsonb,
  added_by      uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  added_via     text NOT NULL DEFAULT 'person' CHECK (added_via IN ('person', 'penny')),
  rotate_after  timestamptz NOT NULL DEFAULT now() + interval '90 days',
  rotation_obligation_id uuid REFERENCES yp_labs.obligations(id) ON DELETE SET NULL,
  last_used_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  removed_at    timestamptz
);
-- One live key per service per business. Replacing one removes the old one.
CREATE UNIQUE INDEX IF NOT EXISTS business_keys_live_idx
  ON yp_labs.business_keys(business_id, service) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS yp_labs.key_uses (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  key_id      uuid NOT NULL REFERENCES yp_labs.business_keys(id) ON DELETE CASCADE,
  action      text NOT NULL CHECK (length(action) BETWEEN 1 AND 120),
  actor_id    uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  via         text NOT NULL CHECK (via IN ('person', 'penny', 'system')),
  ok          boolean NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS key_uses_key_idx ON yp_labs.key_uses(key_id, created_at DESC);

-- Keys are their own permission area, in no preset: like export, access to another company's
-- accounts should be granted on purpose, never arrive with a job title.
ALTER TABLE yp_labs.permissions DROP CONSTRAINT IF EXISTS permissions_area_check;
ALTER TABLE yp_labs.permissions ADD CONSTRAINT permissions_area_check CHECK (area IN (
  'compliance','money','customers','team','documents','projects','sites','export','keys'));

-- Wipe anything already replaced before replacement wiped too.
UPDATE yp_labs.business_keys SET ciphertext='\x00'::bytea WHERE removed_at IS NOT NULL AND length(ciphertext) > 1;
-- And make it impossible to remove a key without wiping it.
ALTER TABLE yp_labs.business_keys DROP CONSTRAINT IF EXISTS removed_is_wiped;
ALTER TABLE yp_labs.business_keys ADD CONSTRAINT removed_is_wiped CHECK (removed_at IS NULL OR length(ciphertext) = 1);
