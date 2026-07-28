-- =====================================================================
-- YP LABS — Concept Marketplace ("The Kiln" / Clay) — Additive Migration v1
-- Set Up Your Place LLC d/b/a Access YP Labs
-- Adds the new marketplace/Clay model INTO the existing yp_labs schema.
-- REUSES existing yp_labs.users (does NOT create a second users table).
-- Additive + idempotent. Touches nothing outside yp_labs. Drops nothing.
-- =====================================================================

SET search_path TO yp_labs, public;

-- ---------- ENUM TYPES ----------
DO $$ BEGIN
  CREATE TYPE yp_labs.concept_mode      AS ENUM ('create','enhance');
  CREATE TYPE yp_labs.concept_stage     AS ENUM ('concept','in_build','prepared_to_start');
  CREATE TYPE yp_labs.concept_category  AS ENUM
    ('digital_product_saas','online_service_agency','content_creator',
     'ecommerce_pod','ai_product_service','remote_hybrid_physical','micro_solo');
  CREATE TYPE yp_labs.asset_type        AS ENUM
    ('business_plan','marketing_strategy','customer_research','competitor_research',
     'regulatory_risk','html_demo','example_image','website_prompt','build_instructions',
     'code_file','built_site');
  CREATE TYPE yp_labs.listing_format    AS ENUM ('flat','auction');
  CREATE TYPE yp_labs.listing_status    AS ENUM ('draft','in_review','live','sold','withdrawn','rejected');
  CREATE TYPE yp_labs.order_status      AS ENUM
    ('created','in_escrow','proof_submitted','delivered','released','cancelled','disputed');
  CREATE TYPE yp_labs.engagement_state  AS ENUM
    ('requested','accepted','nda_signed','paid','session_delivered','window_open',
     'continued','switched','closed_no_continue');
  CREATE TYPE yp_labs.moderation_reason AS ENUM
    ('missing_baseline','running_business','fraud','missing_risk_disclosure');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- PROFILES (extends existing users) ----------
CREATE TABLE IF NOT EXISTS yp_labs.profiles (
  user_id        uuid PRIMARY KEY REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  about_me       text,
  show_concepts  boolean NOT NULL DEFAULT false,
  show_completed boolean NOT NULL DEFAULT true,
  show_listings  boolean NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------- SUBSCRIPTIONS ($2.99/idea or $49.99/mo unlimited) ----------
CREATE TABLE IF NOT EXISTS yp_labs.subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  plan        text NOT NULL CHECK (plan IN ('per_idea','unlimited')),
  concept_id  uuid,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','canceled','past_due')),
  price_cents integer NOT NULL,   -- 299 or 4999
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- CONCEPTS ----------
CREATE TABLE IF NOT EXISTS yp_labs.concepts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  title        text NOT NULL,
  mode         yp_labs.concept_mode NOT NULL,
  category     yp_labs.concept_category,
  stage        yp_labs.concept_stage NOT NULL DEFAULT 'concept',
  parent_id    uuid REFERENCES yp_labs.concepts(id) ON DELETE SET NULL,
  is_housing   boolean NOT NULL DEFAULT false,
  risk_summary text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_concepts_owner  ON yp_labs.concepts(owner_id);
CREATE INDEX IF NOT EXISTS idx_concepts_parent ON yp_labs.concepts(parent_id);

-- ---------- ASSETS ----------
CREATE TABLE IF NOT EXISTS yp_labs.assets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id       uuid NOT NULL REFERENCES yp_labs.concepts(id) ON DELETE CASCADE,
  type             yp_labs.asset_type NOT NULL,
  title            text,
  body             text,
  file_url         text,
  is_baseline      boolean NOT NULL DEFAULT false,
  exclusive_locked boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assets_concept ON yp_labs.assets(concept_id);

-- ---------- GENERATIONS (Clay runs; honesty interpreter states) ----------
CREATE TABLE IF NOT EXISTS yp_labs.generations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id    uuid NOT NULL REFERENCES yp_labs.concepts(id) ON DELETE CASCADE,
  asset_type    yp_labs.asset_type,
  prompt        text,
  result_status text CHECK (result_status IN ('answered','empty','unavailable','refused')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- SELLER ACCOUNTS (Stripe Connect / KYC) ----------
CREATE TABLE IF NOT EXISTS yp_labs.seller_accounts (
  user_id           uuid PRIMARY KEY REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  stripe_account_id text,
  kyc_status        text NOT NULL DEFAULT 'pending' CHECK (kyc_status IN ('pending','verified','restricted')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------- LISTINGS (The Kiln) ----------
CREATE TABLE IF NOT EXISTS yp_labs.listings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id         uuid NOT NULL REFERENCES yp_labs.concepts(id) ON DELETE CASCADE,
  seller_id          uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  format             yp_labs.listing_format NOT NULL DEFAULT 'flat',
  price_cents        integer CHECK (price_cents IS NULL OR price_cents >= 5000),  -- $50 floor
  starting_bid_cents integer,
  auction_close_at   timestamptz,
  completion_target  text,
  stage_label        yp_labs.concept_stage NOT NULL DEFAULT 'concept',
  status             yp_labs.listing_status NOT NULL DEFAULT 'draft',
  risk_disclosed     boolean NOT NULL DEFAULT false,
  ownership_ack      boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_listings_status ON yp_labs.listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_seller ON yp_labs.listings(seller_id);

CREATE TABLE IF NOT EXISTS yp_labs.bids (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   uuid NOT NULL REFERENCES yp_labs.listings(id) ON DELETE CASCADE,
  bidder_id    uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents >= 5000),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bids_listing ON yp_labs.bids(listing_id);

CREATE TABLE IF NOT EXISTS yp_labs.watches (
  user_id    uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES yp_labs.listings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

-- ---------- ORDERS / TRANSFERS (escrow, no refunds) ----------
CREATE TABLE IF NOT EXISTS yp_labs.orders_transfers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id         uuid NOT NULL REFERENCES yp_labs.listings(id),
  buyer_id           uuid NOT NULL REFERENCES yp_labs.users(id),
  seller_id          uuid NOT NULL REFERENCES yp_labs.users(id),
  amount_cents       integer NOT NULL,
  platform_fee_cents integer NOT NULL,   -- 20%
  status             yp_labs.order_status NOT NULL DEFAULT 'created',
  agreement_accepted boolean NOT NULL DEFAULT false,
  risk_ack           boolean NOT NULL DEFAULT false,
  no_refund_ack      boolean NOT NULL DEFAULT false,
  proof_of_shipment  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  delivered_at       timestamptz
);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON yp_labs.orders_transfers(buyer_id);

-- ---------- CONSULTANTS ----------
CREATE TABLE IF NOT EXISTS yp_labs.consultant_applications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  entrepreneur_history text,
  marketplace_track    text,
  concepts_to_market   text,
  prior_businesses     text,
  status               text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected')),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yp_labs.consultants (
  user_id             uuid PRIMARY KEY REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  approved            boolean NOT NULL DEFAULT false,
  badge               boolean NOT NULL DEFAULT false,
  auto_enrolled       boolean NOT NULL DEFAULT false,
  rate_display        text,
  successful_launches integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS yp_labs.consultant_engagements (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            uuid NOT NULL REFERENCES yp_labs.users(id),
  consultant_id        uuid NOT NULL REFERENCES yp_labs.users(id),
  concept_id           uuid REFERENCES yp_labs.concepts(id) ON DELETE SET NULL,
  state                yp_labs.engagement_state NOT NULL DEFAULT 'requested',
  nda_signed_at        timestamptz,                 -- HARD gate before concept is shared
  fee_cents            integer NOT NULL DEFAULT 15000, -- $150
  platform_cut_cents   integer NOT NULL DEFAULT 3000,  -- 20% = $30
  consultant_cut_cents integer NOT NULL DEFAULT 12000, -- 80% = $120 (always earned on delivery)
  session_delivered_at timestamptz,
  window_expires_at    timestamptz,                 -- 12-hour continuation window
  launch_confirmed     boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_engagements_client     ON yp_labs.consultant_engagements(client_id);
CREATE INDEX IF NOT EXISTS idx_engagements_consultant ON yp_labs.consultant_engagements(consultant_id);

-- ---------- REVIEWS ----------
CREATE TABLE IF NOT EXISTS yp_labs.reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id    uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('listing','consultant')),
  subject_id   uuid NOT NULL,
  rating       integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------- MODERATION (neutrality: reason codes, recusal, audit) ----------
CREATE TABLE IF NOT EXISTS yp_labs.moderation_actions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   uuid NOT NULL REFERENCES yp_labs.listings(id) ON DELETE CASCADE,
  moderator_id uuid NOT NULL REFERENCES yp_labs.users(id),
  decision     text NOT NULL CHECK (decision IN ('approved','rejected')),
  reason       yp_labs.moderation_reason,   -- required on rejection; "competes with mine" not selectable
  recused      boolean NOT NULL DEFAULT false,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_moderation_listing ON yp_labs.moderation_actions(listing_id);

-- =====================================================================
-- End additive migration. New tables: 15. Reuses existing yp_labs.users.
-- =====================================================================
