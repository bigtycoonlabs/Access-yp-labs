-- THIRTEEN TABLES EXISTED IN PRODUCTION AND NOWHERE IN VERSION CONTROL.
--
-- Found by starting a sweep from the homepage: /api/hello returned 500 on every single load,
-- because it reads a `visitors` table that a from-scratch build of this schema does not create. It
-- worked in production purely because that table was made by hand at some point and never written
-- down. Comparing the full production schema against the migrations turned up twelve more — INCLUDING
-- `users`, `site_pages`, `store_products` and `stripe_events`.
--
-- What that meant in practice: restoring this platform from the repository would have produced a
-- system with no user table. Not a degraded system — one that cannot start. And the homepage was
-- already 500ing on a real endpoint, in a way no test caught because every test ran against a
-- database that had been built up by hand rather than from these files.
--
-- These definitions were read out of the live database, column by column, so they match production
-- exactly rather than being a guess at what they probably contain. IF NOT EXISTS throughout, so
-- applying this to production is a no-op and it only does work on a fresh build.

CREATE TABLE IF NOT EXISTS yp_labs.users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email varchar NOT NULL,
  password_hash text,
  name varchar NOT NULL,
  role varchar NOT NULL DEFAULT 'member',
  status varchar NOT NULL DEFAULT 'active',
  phone varchar,
  business_name varchar,
  referral_source varchar,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  display_name text,
  pending_idea text,
  billing_test boolean NOT NULL DEFAULT false,
  open_to_partnering boolean NOT NULL DEFAULT false
);

-- Anonymous visitors, so the homepage can greet a returning stranger without an account. This is
-- the one whose absence made /api/hello fail.
CREATE TABLE IF NOT EXISTS yp_labs.visitors (
  token text PRIMARY KEY,
  ip_hash text,
  visit_count integer NOT NULL DEFAULT 1,
  taste_count integer NOT NULL DEFAULT 0,
  taste_day date,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yp_labs.login_activity (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid,
  email varchar(255),
  success boolean NOT NULL DEFAULT false,
  ip_address inet,
  user_agent text,
  reason varchar(255),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Stripe de-duplication. Without this table every webhook would be processed twice on retry, which
-- for a payment processor is not a small problem.
CREATE TABLE IF NOT EXISTS yp_labs.stripe_events (
  id varchar(255) PRIMARY KEY,
  event_type varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yp_labs.site_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'page',
  nav_order integer NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yp_labs.site_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  hostname text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  cf_hostname_id text,
  verification jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yp_labs.store_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  name text NOT NULL,
  price_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  description text,
  image_url text,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL DEFAULT 'digital',
  fulfillment_url text
);

CREATE TABLE IF NOT EXISTS yp_labs.store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id uuid NOT NULL,
  product_id uuid,
  seller_account_id text NOT NULL,
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  product_name text NOT NULL,
  buyer_email text,
  stripe_session_id text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  shipping text
);

CREATE TABLE IF NOT EXISTS yp_labs.image_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id uuid NOT NULL,
  user_id uuid,
  source text NOT NULL DEFAULT 'auto',
  billed text NOT NULL DEFAULT 'free',
  alt_text text,
  storage_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Retired (image packs are no longer sold), but any balance someone bought is still honoured and
-- still spends, so the table must exist for a restore to be faithful.
CREATE TABLE IF NOT EXISTS yp_labs.concept_image_credits (
  concept_id uuid PRIMARY KEY,
  balance integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yp_labs.staff_invites (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email varchar(255) NOT NULL,
  name varchar(255),
  temporary_password varchar(255),
  status varchar(40) NOT NULL DEFAULT 'sent',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yp_labs.discount_codes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code varchar(80) NOT NULL,
  description text,
  discount_type varchar(20) NOT NULL,
  discount_value numeric NOT NULL,
  max_redemptions integer,
  redemptions integer NOT NULL DEFAULT 0,
  starts_at timestamptz,
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS yp_labs.service_catalog (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_type varchar(100) NOT NULL,
  name varchar(255) NOT NULL,
  price numeric NOT NULL,
  sla_hours integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON yp_labs.users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS site_pages_concept_slug_key ON yp_labs.site_pages (concept_id, slug);
CREATE INDEX IF NOT EXISTS login_activity_user_idx ON yp_labs.login_activity (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS image_generations_concept_idx ON yp_labs.image_generations (concept_id, created_at DESC);
CREATE INDEX IF NOT EXISTS store_orders_concept_idx ON yp_labs.store_orders (concept_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS discount_codes_code_key ON yp_labs.discount_codes (lower(code));
