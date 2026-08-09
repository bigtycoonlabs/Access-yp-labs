-- WHERE A VISITOR CAME FROM.
--
-- Clay Weekly signups carry a source, so a share link can be judged on whether it brought anyone.
-- Listings carry nothing. Somebody promoting a listing across four channels for a month had no way
-- to know which one worked, or whether any did — so the marketing half of the operations role could
-- not be measured or managed, and the person doing it would be judged on their own opinion of their
-- work.
--
-- One row per arrival, not a counter. A counter tells you 40; this tells you 40 from instagram, 3 of
-- which came back, and none of which were on a Tuesday. Aggregates can always be derived from
-- events; events can never be recovered from an aggregate.
CREATE TABLE IF NOT EXISTS yp_labs.listing_visits (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid NOT NULL REFERENCES yp_labs.listings(id) ON DELETE CASCADE,
  source      text,
  -- Which visitor, so a return visit is distinguishable from a new one. This is the anonymous
  -- visitor token the platform already issues — no account, no personal detail, nothing that
  -- identifies a person.
  visitor     text,
  -- Whether they were signed in AT THE TIME. Not who they were: a listing view is browsing, and
  -- recording which named creator looked at which listing would be surveillance rather than
  -- analytics.
  signed_in   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listing_visits_listing_idx ON yp_labs.listing_visits (listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS listing_visits_source_idx  ON yp_labs.listing_visits (source, created_at DESC);

-- Promotion log: what was posted, where, and when. The console already asks "which listings have
-- never been promoted" and answers it from listing_events, which is a stretch of that table's
-- meaning. This is the real record, and it is what a promotion rotation is built from.
CREATE TABLE IF NOT EXISTS yp_labs.listing_promotions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid NOT NULL REFERENCES yp_labs.listings(id) ON DELETE CASCADE,
  channel     text NOT NULL,
  note        text,
  staff_id    uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_promotions_listing_idx ON yp_labs.listing_promotions (listing_id, created_at DESC);
