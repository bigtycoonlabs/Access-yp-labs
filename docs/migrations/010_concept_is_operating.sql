-- 010: mark a concept as a business the user ALREADY RUNS (an ongoing operation
-- Clay is enhancing) vs. an unlaunched idea. Operating businesses can be enhanced
-- with Clay but can NEVER be listed in the Dreamhold — the Dreamhold sells
-- unlaunched ideas, not running businesses.
ALTER TABLE yp_labs.concepts
  ADD COLUMN IF NOT EXISTS is_operating boolean NOT NULL DEFAULT false;
