-- 025_site_pages.sql
-- Multi-page sites: Clay can build a real starting MVP (a blog / resource site), not just a
-- single coming-soon page. Each concept's launch_page.slug is the site's base address; these
-- rows are the additional pages, served publicly at /p/<site-slug>/<page-slug> once the site's
-- home (its landing page) is published and the page itself is published.
CREATE TABLE IF NOT EXISTS site_pages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id  uuid NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  owner_id    uuid NOT NULL,
  slug        text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  kind        text NOT NULL DEFAULT 'page',   -- 'page' (standing page) | 'post' (article/blog)
  nav_order   integer NOT NULL DEFAULT 0,
  published   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT site_pages_slug_unique UNIQUE (concept_id, slug)
);
CREATE INDEX IF NOT EXISTS site_pages_concept_idx ON site_pages(concept_id);
CREATE INDEX IF NOT EXISTS site_pages_pub_idx ON site_pages(concept_id, published);
