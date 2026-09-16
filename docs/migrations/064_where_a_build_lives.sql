-- 064: WHERE A BUILD LIVES.
--
-- The owner decided on 16 Sept 2026 that Penny explains three homes for what she builds, and
-- suggests the smallest one that does the job:
--   labs_site    a site hosted on Access YP Labs: a landing page, a wedding site, a menu, a quote form
--   labs_portal  the Labs customer portal, attached to that site, where customers see what is theirs
--   custom_app   a web application with its own backend, launched on the client's own GitHub,
--                Railway and Supabase
-- The tier is recorded on the build, because it decides what "live" means for it.
--
-- A labs_site can be put online at accessyplabs.com/s/<address>. Messages sent from its forms are
-- kept here and raise a reply on the owner's Today.
--
-- Applied to production 16 Sept 2026. Verified there in a rolled-back function: a mock-up online, a
-- custom app online here, a malformed address, an address taken twice and a non-object message were
-- refused; a real Labs site online and a site-sourced reply were accepted.

ALTER TABLE yp_labs.builds
  ADD COLUMN IF NOT EXISTS tier text,
  ADD COLUMN IF NOT EXISTS published_slug text,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

ALTER TABLE yp_labs.builds DROP CONSTRAINT IF EXISTS builds_tier_known;
ALTER TABLE yp_labs.builds ADD CONSTRAINT builds_tier_known CHECK (
  tier IS NULL OR tier IN ('labs_site', 'labs_portal', 'custom_app'));

-- Only a finished, real Labs site can be online. A mock-up is a draft, and a custom app goes live on
-- the client's own accounts, not here.
ALTER TABLE yp_labs.builds DROP CONSTRAINT IF EXISTS only_real_sites_go_online;
ALTER TABLE yp_labs.builds ADD CONSTRAINT only_real_sites_go_online CHECK (
  published_slug IS NULL OR (stage = 'real' AND tier = 'labs_site' AND published_at IS NOT NULL));

ALTER TABLE yp_labs.builds DROP CONSTRAINT IF EXISTS published_slug_shape;
ALTER TABLE yp_labs.builds ADD CONSTRAINT published_slug_shape CHECK (
  published_slug IS NULL OR published_slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$');

CREATE UNIQUE INDEX IF NOT EXISTS builds_published_slug_idx ON yp_labs.builds(published_slug)
  WHERE published_slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS yp_labs.site_messages (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  build_id     uuid NOT NULL REFERENCES yp_labs.builds(id) ON DELETE CASCADE,
  business_id  uuid NOT NULL REFERENCES yp_labs.businesses(id) ON DELETE CASCADE,
  -- What the visitor typed, field by field, as the page named them.
  fields       jsonb NOT NULL CHECK (jsonb_typeof(fields) = 'object'),
  -- A hash, never the address itself: enough to slow a flood, not enough to track a person.
  sender_hash  text NOT NULL,
  obligation_id uuid REFERENCES yp_labs.obligations(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz
);
CREATE INDEX IF NOT EXISTS site_messages_business_idx
  ON yp_labs.site_messages(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS site_messages_flood_idx
  ON yp_labs.site_messages(build_id, sender_hash, created_at DESC);

-- A message from a hosted site raises a reply on Today, and says where it came from.
ALTER TABLE yp_labs.obligations DROP CONSTRAINT IF EXISTS obligations_source_check;
ALTER TABLE yp_labs.obligations ADD CONSTRAINT obligations_source_check CHECK (
  source IN ('stated','rule_engine','gmail','flow','ayp','imported','penny','site'));
