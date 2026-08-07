-- Clay Weekly for people who do not have an account.
--
-- Until now the only way to receive the magazine was to register, so the one thing on this platform
-- capable of reaching strangers could only reach people who had already arrived. This makes the
-- magazine a front door rather than a members' benefit.
--
-- Deliberately its own table rather than fake user rows: a subscriber is not an account, has no
-- password, owns nothing, and can never sign in. Keeping them separate means no code that assumes
-- "a user can log in" can ever be handed one of these.

CREATE TABLE IF NOT EXISTS yp_labs.weekly_subscribers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  first_name    text,
  last_name     text,
  -- Double opt-in. Nobody is emailed a magazine until they have confirmed they want it: unconfirmed
  -- rows are never sent to, which protects both them and our sending reputation.
  confirmed_at  timestamptz,
  confirm_token text NOT NULL,
  -- One-click unsubscribe, same as for account holders.
  unsub_token   text NOT NULL,
  unsubscribed_at timestamptz,
  -- Where they came from, so a shared link can be judged on whether it actually worked.
  source        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per address, case-insensitively: signing up twice must update, never duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS weekly_subscribers_email_key
  ON yp_labs.weekly_subscribers (lower(email));
CREATE INDEX IF NOT EXISTS weekly_subscribers_confirmed_idx
  ON yp_labs.weekly_subscribers (confirmed_at) WHERE unsubscribed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS weekly_subscribers_confirm_token_key
  ON yp_labs.weekly_subscribers (confirm_token);
CREATE UNIQUE INDEX IF NOT EXISTS weekly_subscribers_unsub_token_key
  ON yp_labs.weekly_subscribers (unsub_token);
