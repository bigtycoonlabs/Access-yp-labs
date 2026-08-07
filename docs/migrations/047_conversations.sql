-- STORING WHAT PEOPLE ACTUALLY SAY TO CLAY.
--
-- Nothing was stored. Every conversation on this platform has been thrown away the moment it ended,
-- so the only thing anyone could learn from was what got CREATED — which tells you where somebody
-- stopped and never why. Four projects stalled in the identical state and nobody could see what was
-- said before the silence.
--
-- Deliberate limits, because a chat log is one of the most sensitive things a platform can hold:
--   * Staff cannot read message CONTENT. The tables exist so we can see shape — how long a session
--     ran, where it ended, whether a tool failed — not to read people's ideas.
--   * A creator can delete their own history, and it goes for real.
--   * Nothing here is used to train anything.

CREATE TABLE IF NOT EXISTS yp_labs.clay_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES yp_labs.users(id) ON DELETE CASCADE,
  concept_id   uuid REFERENCES yp_labs.concepts(id) ON DELETE SET NULL,
  surface      text NOT NULL DEFAULT 'laboratory',   -- laboratory | project | public
  started_at   timestamptz NOT NULL DEFAULT now(),
  last_at      timestamptz NOT NULL DEFAULT now(),
  turns        integer NOT NULL DEFAULT 0,
  -- The whole point of the exercise: what was happening when it ended.
  last_status  text,          -- answered | unavailable | refused | empty
  last_tool    text,
  ended_reason text           -- completed | abandoned | error
);

CREATE TABLE IF NOT EXISTS yp_labs.clay_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES yp_labs.clay_sessions(id) ON DELETE CASCADE,
  role        text NOT NULL,          -- user | clay
  content     text NOT NULL,
  status      text,                   -- for Clay's turns: how it resolved
  tools_used  text[] NOT NULL DEFAULT '{}',
  tool_failed boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clay_sessions_user_idx    ON yp_labs.clay_sessions (user_id, last_at DESC);
CREATE INDEX IF NOT EXISTS clay_sessions_concept_idx ON yp_labs.clay_sessions (concept_id);
CREATE INDEX IF NOT EXISTS clay_messages_session_idx ON yp_labs.clay_messages (session_id, created_at);
