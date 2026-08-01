-- 013: Clay's cross-session memory — durable facts Clay chooses to remember about a
-- builder (their goals, constraints, preferences) so he carries them from one session to
-- the next instead of meeting them cold every time. Ported in spirit from Arbo's memory.
--
-- Only readable text lives here: NO balances, NO secrets, NO passwords, NO card data —
-- Clay is told never to store those. A fact marked 'private' is shown to the builder and
-- to Clay but never to staff (see redactedMemoryForAdmin). The builder owns this memory:
-- they can ask Clay to forget one fact or wipe all of it. One row per (user, key); a
-- re-remember updates the value in place rather than piling up duplicates.
CREATE TABLE IF NOT EXISTS yp_labs.clay_memory (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  memory_key   text NOT NULL,
  memory_value text NOT NULL,
  sensitivity  text NOT NULL DEFAULT 'normal',  -- normal | private
  source       text,                            -- e.g. builder_said | observed
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, memory_key)
);
CREATE INDEX IF NOT EXISTS idx_clay_memory_user ON yp_labs.clay_memory(user_id);
