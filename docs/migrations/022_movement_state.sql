-- 022: the per-concept movement board.
--
-- From Clay's weekly review, endorsed by the founder: make visible the lane each concept is really
-- in, so a creator can watch a concept move instead of assuming it's further along than it is.
-- Three honest lanes, in order: needs_customer_clarity -> needs_proof -> ready_to_package. A concept
-- advances only on real behavior (proof), never on how finished it reads — the same proof discipline
-- Clay reasons with (4.8), now something the creator can see and track.
--
-- Everything starts in the earliest lane, because nothing is proven until it is proven. The one
-- honest exception in the backfill: a concept that already has real waitlist demand has a customer
-- who has raised a hand, so it is at least past "needs customer clarity" — but demand interest is
-- not purchase proof, so it goes no further than "needs proof".

ALTER TABLE concepts
  ADD COLUMN IF NOT EXISTS movement_state text NOT NULL DEFAULT 'needs_customer_clarity'
    CHECK (movement_state IN ('needs_customer_clarity','needs_proof','ready_to_package')),
  ADD COLUMN IF NOT EXISTS movement_note text,
  ADD COLUMN IF NOT EXISTS movement_updated_at timestamptz;

UPDATE concepts c
   SET movement_state = 'needs_proof', movement_updated_at = now()
 WHERE c.movement_state = 'needs_customer_clarity'
   AND EXISTS (SELECT 1 FROM waitlist_signups w WHERE w.concept_id = c.id);
