-- 043: projects someone already paid for stay free, permanently.
--
-- We retired the per-project charge. Anyone who was paying $2.99 for a specific project stops being
-- charged — but the project they paid for must not quietly re-lock behind the new plan. They bought
-- it under one deal; changing our packaging is not their problem.
--
-- So: any project that ever had a paid per-project subscription is marked free forever. This is a
-- flag on the project rather than a rule about subscriptions, deliberately — it keeps holding after
-- the subscription is cancelled, which is exactly the case it exists for.

ALTER TABLE yp_labs.concepts ADD COLUMN IF NOT EXISTS free_forever boolean NOT NULL DEFAULT false;

UPDATE yp_labs.concepts c
   SET free_forever = true
 WHERE EXISTS (
   SELECT 1 FROM yp_labs.subscriptions s
    WHERE s.concept_id = c.id AND s.plan = 'maker'
 );
