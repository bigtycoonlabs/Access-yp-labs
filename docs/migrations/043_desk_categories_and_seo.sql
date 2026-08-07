-- 043: make the Desk browsable and findable.
--
-- What was wrong. `topic` held a whole sentence — "the night an idea that felt impossible turned out
-- to be simple" — which is a good angle for a piece and useless as a category: 32 articles produced
-- 24 distinct "topics", so nothing could be browsed. And SEO was half-built: every piece had an
-- address, but only 5 of 32 had a meta description and none had a picture, because those were
-- written before that machinery existed.
--
-- category is a small fixed set a reader can actually navigate. keywords is what the piece is
-- deliberately written to be found for.

ALTER TABLE yp_labs.desk_articles ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE yp_labs.desk_articles ADD COLUMN IF NOT EXISTS keywords  text[] NOT NULL DEFAULT '{}';

-- Backfill from the sentence-topics we already have, by what each is plainly about. Anything that
-- does not match lands in 'starting-out', which is the honest default for this Desk rather than a
-- vague 'other' that tells a reader nothing.
UPDATE yp_labs.desk_articles SET category =
  CASE
    WHEN topic ~* 'price|pricing|priced'                         THEN 'pricing'
    WHEN topic ~* 'marketing|channel|positioning|benefit'        THEN 'marketing'
    WHEN topic ~* 'customer|first ten|stranger|proof|believer'   THEN 'finding-customers'
    WHEN topic ~* 'sell|sold|buying|buy|dream market|asset'      THEN 'buying-and-selling'
    WHEN topic ~* 'hire|help|hand off|partner|two creators'      THEN 'getting-help'
    WHEN topic ~* 'grow|growing|already ran|next dollar|doubled' THEN 'growing'
    ELSE 'starting-out'
  END
WHERE category IS NULL;

CREATE INDEX IF NOT EXISTS desk_articles_category_idx
  ON yp_labs.desk_articles (category, published_at DESC) WHERE status = 'published';
