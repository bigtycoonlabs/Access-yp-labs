-- 018_concept_intents.sql
-- Per-concept creator intent — the keystone of Clay-as-coach.
--
-- For each concept, the creator has a plan: build it themselves and launch it as a real business,
-- or keep refining it to sell at the highest value in the Dreamhold, or they're still exploring.
-- Until now Clay had no structured place to KNOW that plan, so he couldn't coach toward it and the
-- founder had to explain the paths by hand. This table records the creator's chosen path per
-- concept so Clay reads it in every conversation, coaches toward it, and asks when it's unknown.
--
-- Keyed unique on (concept_id, user_id): the concept's owner has one active intent for it. Keyed by
-- user too so a buyer who later owns a concept can set their own plan without clobbering history.
-- Purely additive; nothing else depends on it.

CREATE TABLE IF NOT EXISTS yp_labs.concept_intents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_id  uuid NOT NULL REFERENCES yp_labs.concepts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES yp_labs.users(id)    ON DELETE CASCADE,
  path        text NOT NULL CHECK (path = ANY (ARRAY['build_myself','refine_to_sell','exploring'])),
  note        text,
  set_by      text NOT NULL DEFAULT 'user' CHECK (set_by = ANY (ARRAY['user','clay'])),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (concept_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_concept_intents_concept ON yp_labs.concept_intents (concept_id);
CREATE INDEX IF NOT EXISTS idx_concept_intents_user    ON yp_labs.concept_intents (user_id);
