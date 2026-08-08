-- PASSWORD RESET. There was none.
--
-- No forgot-password route, no reset route, no admin path, and the sign-in page did not even
-- acknowledge the possibility. Anyone who forgot their password was permanently locked out of every
-- project they had built, and staff had no way to help them — the only recovery was creating a new
-- account and abandoning their work.
--
-- Tokens are stored HASHED, for the same reason passwords are: a leak of this table must not hand
-- somebody the ability to take over accounts. Single-use, short-lived, and invalidated the moment
-- the password actually changes.
CREATE TABLE IF NOT EXISTS yp_labs.password_resets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS password_resets_token_key ON yp_labs.password_resets (token_hash);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON yp_labs.password_resets (user_id, created_at DESC);
