-- 065: THE CUSTOMER PORTAL.
--
-- One portal per business, where each customer signs in and sees what is theirs. The owner decided on
-- 16 Sept 2026 that Penny customises it for them, and that it is flexible within limits: the portal
-- is built from a fixed set of sections that can be turned on, ordered, renamed and filled. Anything
-- beyond those sections needs a backend and is a custom web application instead.
--
-- CUSTOMERS SIGN IN WITH A LINK, NOT A PASSWORD. A plumber's customers will not remember a password
-- for a portal they open twice a year. The link is single use, short lived, and stored only as a hash.
--
-- A CUSTOMER SEES ONLY WHAT IS THEIRS. Every row a customer can read carries their id. Nothing is
-- shown to them by matching a name.
--
-- Applied to production 16 Sept 2026. Verified there in a rolled-back function: a portal opened
-- with no address, a malformed email, the same email twice in another case, a 2-hour sign-in link,
-- a 60-day session and an owner message with no author were refused; an open portal with an address
-- and a portal-sourced item for a customer were accepted.

CREATE TABLE IF NOT EXISTS yp_labs.portals (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id  uuid NOT NULL UNIQUE REFERENCES yp_labs.businesses(id) ON DELETE CASCADE,
  slug         text UNIQUE CHECK (slug IS NULL OR slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  -- The whole customisation, validated in the application against a fixed schema. Kept as one
  -- document so Penny changes it the same way the screen does.
  config       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  is_open      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT open_needs_address CHECK (NOT is_open OR slug IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS yp_labs.portal_customers (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id  uuid NOT NULL REFERENCES yp_labs.businesses(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  email        text NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  invited_at   timestamptz,
  last_seen_at timestamptz,
  removed_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS portal_customers_email_idx
  ON yp_labs.portal_customers(business_id, lower(email)) WHERE removed_at IS NULL;

-- Sign-in links and sessions. Only hashes are stored.
CREATE TABLE IF NOT EXISTS yp_labs.portal_tokens (
  token_hash   text PRIMARY KEY,
  customer_id  uuid NOT NULL REFERENCES yp_labs.portal_customers(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('link', 'session')),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT link_is_short CHECK (kind <> 'link' OR expires_at <= created_at + interval '31 minutes'),
  CONSTRAINT session_ends CHECK (kind <> 'session' OR expires_at <= created_at + interval '31 days')
);
CREATE INDEX IF NOT EXISTS portal_tokens_customer_idx ON yp_labs.portal_tokens(customer_id);

-- Files the owner has shared with one customer.
CREATE TABLE IF NOT EXISTS yp_labs.portal_files (
  customer_id  uuid NOT NULL REFERENCES yp_labs.portal_customers(id) ON DELETE CASCADE,
  file_id      uuid NOT NULL REFERENCES yp_labs.files(id) ON DELETE CASCADE,
  shared_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, file_id)
);

-- One conversation per customer. from_customer says who wrote it.
CREATE TABLE IF NOT EXISTS yp_labs.portal_messages (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id   uuid NOT NULL REFERENCES yp_labs.portal_customers(id) ON DELETE CASCADE,
  business_id   uuid NOT NULL REFERENCES yp_labs.businesses(id) ON DELETE CASCADE,
  from_customer boolean NOT NULL,
  author_id     uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  -- A request sent through the portal's request form keeps its fields.
  fields        jsonb CHECK (fields IS NULL OR jsonb_typeof(fields) = 'object'),
  obligation_id uuid REFERENCES yp_labs.obligations(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_side_has_author CHECK (from_customer OR author_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS portal_messages_customer_idx
  ON yp_labs.portal_messages(customer_id, created_at);

-- What is owed each way, attached to the customer it concerns, so the portal can show it.
ALTER TABLE yp_labs.obligations
  ADD COLUMN IF NOT EXISTS portal_customer_id uuid REFERENCES yp_labs.portal_customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS obligations_portal_customer_idx
  ON yp_labs.obligations(portal_customer_id) WHERE portal_customer_id IS NOT NULL;

ALTER TABLE yp_labs.obligations DROP CONSTRAINT IF EXISTS obligations_source_check;
ALTER TABLE yp_labs.obligations ADD CONSTRAINT obligations_source_check CHECK (
  source IN ('stated','rule_engine','gmail','flow','ayp','imported','penny','site','portal'));
