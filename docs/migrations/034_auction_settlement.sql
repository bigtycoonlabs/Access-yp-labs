-- 034: settle auctions when the clock runs out.
--
-- Today an auction's close time passes, bids stop being accepted, and then… nothing. The listing
-- sits there with a high bidder nobody told, no winner recorded, and no way for either side to know
-- what happens next. A market whose auctions never resolve teaches people the market isn't real —
-- which is the single most expensive thing this platform could teach.
--
-- Deliberately ADDITIVE: the listing's status is untouched, so a settled auction stays reachable and
-- the winner can still complete the purchase through the existing flow. Bids are already refused
-- after the close time, so settlement records the outcome rather than changing the rules.

ALTER TABLE yp_labs.listings ADD COLUMN IF NOT EXISTS settled_at         timestamptz;
ALTER TABLE yp_labs.listings ADD COLUMN IF NOT EXISTS winner_id          uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL;
ALTER TABLE yp_labs.listings ADD COLUMN IF NOT EXISTS winning_bid_cents  integer;

-- Finding auctions whose clock has run out but which haven't been settled yet.
CREATE INDEX IF NOT EXISTS listings_auction_due_idx
  ON yp_labs.listings (auction_close_at)
  WHERE settled_at IS NULL AND auction_close_at IS NOT NULL;
