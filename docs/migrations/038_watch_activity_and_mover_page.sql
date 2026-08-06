-- 038: two things people asked for.
--
-- (1) WATCHING A DREAM MEANS SOMETHING. Watches already existed, but nothing ever told a watcher
--     anything — a watch that never speaks is decoration. Activity on a listing is now recorded as
--     events, and watchers are told. Events are stored rather than emailed on the spot so several
--     things happening at once become ONE message instead of five, and so a mail failure can be
--     retried instead of losing the news.
--
-- (2) A DREAM MOVER'S PAGE IS THEIRS. A photo, a bio, links to their own sites and socials, and
--     their own choice of whether to appear under their dreamer tag or their real name.

CREATE TABLE IF NOT EXISTS yp_labs.listing_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid NOT NULL REFERENCES yp_labs.listings(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('bid','value_added','price_changed','sold','auction_ended','relisted')),
  detail      text,                       -- one plain sentence, already written for a person to read
  created_at  timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz                 -- null until watchers have been told
);
CREATE INDEX IF NOT EXISTS listing_events_pending_idx ON yp_labs.listing_events (created_at) WHERE notified_at IS NULL;
CREATE INDEX IF NOT EXISTS listing_events_listing_idx ON yp_labs.listing_events (listing_id, created_at DESC);

-- Watch mail is separate from the magazine: someone may want news about a dream they are following
-- and nothing else, or the reverse. One switch each.
ALTER TABLE yp_labs.user_email_prefs ADD COLUMN IF NOT EXISTS watch_activity boolean NOT NULL DEFAULT true;

-- The Dream Mover's own page.
ALTER TABLE yp_labs.dream_movers ADD COLUMN IF NOT EXISTS photo_url      text;
ALTER TABLE yp_labs.dream_movers ADD COLUMN IF NOT EXISTS links          jsonb NOT NULL DEFAULT '[]'::jsonb;
-- false = show the dreamer tag (the private default), true = show their real first and last name.
-- Defaults to the PRIVATE option: revealing a real name must be a deliberate choice, never a default.
ALTER TABLE yp_labs.dream_movers ADD COLUMN IF NOT EXISTS show_real_name boolean NOT NULL DEFAULT false;
