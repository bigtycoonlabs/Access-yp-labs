-- 032: give each Desk piece its own PAGE — a stable address, an image, and SEO fields.
--
-- Until now the Desk rendered every published piece inline as one long run of text: nothing was
-- clickable, nothing had its own address, and search engines had a single page to index no matter
-- how much Clay wrote. Each article now gets a slug (its own URL), an optional generated image with
-- alt text (so the page has something to show and to SHARE, and screen readers still get a real
-- description), and a short meta description for search results.
--
-- Additive only: every column is nullable or defaulted, so existing rows and code keep working.

ALTER TABLE yp_labs.desk_articles ADD COLUMN IF NOT EXISTS slug        text;
ALTER TABLE yp_labs.desk_articles ADD COLUMN IF NOT EXISTS image_url   text;
ALTER TABLE yp_labs.desk_articles ADD COLUMN IF NOT EXISTS image_alt   text;
ALTER TABLE yp_labs.desk_articles ADD COLUMN IF NOT EXISTS meta_desc   text;

-- Backfill a slug for anything already written: lowercase, letters/numbers/dashes only, trimmed,
-- with a short id suffix so two pieces sharing a title can never collide.
UPDATE yp_labs.desk_articles
   SET slug = trim(both '-' from regexp_replace(lower(coalesce(title, 'piece')), '[^a-z0-9]+', '-', 'g'))
              || '-' || substr(id::text, 1, 6)
 WHERE slug IS NULL;

-- One piece per address.
CREATE UNIQUE INDEX IF NOT EXISTS desk_articles_slug_key ON yp_labs.desk_articles (slug);
