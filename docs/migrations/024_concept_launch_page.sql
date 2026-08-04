-- 024: the coming-soon launch page.
--
-- The incubator move. Until now a concept could only collect public waitlist signups once it was
-- LISTED FOR SALE in the Dream Market. That left out the creator who wants to LAUNCH the idea
-- themselves: they had no way to put up a public "coming soon" page, share it, and collect a first
-- customer list as real proof of demand. This adds that page.
--
-- launch_page is a small JSON object on the concept:
--   { enabled: bool, slug: text, headline, subhead, blurb, cta_label }
-- Clay and the creator write the copy together; publishing makes a public page at /p/<slug> whose
-- email capture feeds the SAME waitlist_signups the sale flow uses — so the demand is real, it
-- counts as proof, and it travels with the concept if it's ever sold. Reversible: a creator can
-- unpublish at any time. Nullable until a launch page is set up.

ALTER TABLE concepts ADD COLUMN IF NOT EXISTS launch_page jsonb;

-- Unique public slug when present, so /p/<slug> resolves to exactly one concept. Partial unique
-- index: only enforced for concepts that actually have a slug set.
CREATE UNIQUE INDEX IF NOT EXISTS concepts_launch_slug_uidx
  ON concepts ((launch_page->>'slug'))
  WHERE launch_page->>'slug' IS NOT NULL;
