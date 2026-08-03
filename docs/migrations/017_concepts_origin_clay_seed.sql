-- 017_concepts_origin_clay_seed.sql
-- ROOT-CAUSE FIX for "Clay has never seeded a single concept."
--
-- The seeding pipeline inserts seed concepts with origin='clay_seed' (persistSeed), and the app
-- already treats 'clay_seed' as a first-class origin everywhere: the scheduler counts
-- origin='clay_seed' toward the daily target, status() reports seeded_total by it, and the seeder's
-- avoid-list queries it. But the concepts_origin_check CHECK constraint was never updated past the
-- original ('created','purchased') set. So EVERY seed attempt threw
--   new row for relation "concepts" violates check constraint "concepts_origin_check"
-- at the concept insert — caught by runSeed's try/catch and returned as reason:'error'. The result
-- was silent, total failure: seeded_total stayed 0 no matter how many times the scheduler ran.
--
-- This adds 'clay_seed' to the allowed set. Purely additive to the constraint; existing rows
-- (all 'created'/'purchased') remain valid.

ALTER TABLE yp_labs.concepts DROP CONSTRAINT concepts_origin_check;

ALTER TABLE yp_labs.concepts ADD CONSTRAINT concepts_origin_check
  CHECK (origin = ANY (ARRAY['created'::text, 'purchased'::text, 'clay_seed'::text]));
