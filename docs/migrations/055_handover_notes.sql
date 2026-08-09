-- THE END-OF-SHIFT NOTE.
--
-- The single highest-value habit in the operations role, and the cheapest thing on this list to
-- build. It is what makes the work visible to owners who are asleep while it happens, what makes a
-- second hire take a week rather than a month, and what makes the first hire replaceable without the
-- platform going dark. One person doing every queue means one person is the only one who knows how
-- anything is done — the note is the antidote to that.
--
-- Deliberately NOT free text alone. A blank box gets "all good" every day, which is worth nothing.
-- The four fields below are the four things somebody picking up the next shift actually needs, and
-- asking for them separately is what stops the note collapsing into a formality.
CREATE TABLE IF NOT EXISTS yp_labs.handover_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id      uuid REFERENCES yp_labs.users(id) ON DELETE SET NULL,
  shift_date    date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  -- What was dealt with.
  cleared       text,
  -- What was passed up, and why. The most important field: an escalation nobody records is an
  -- escalation nobody follows up.
  escalated     text,
  -- What was posted and where. Marketing is most of this role, so it belongs in the daily record
  -- rather than being remembered at the end of a week.
  promoted      text,
  -- Anything that looked odd but was not clearly wrong. This is where the next real bug usually
  -- shows up first, and it is exactly what gets dropped when a note is one free-text box.
  odd           text,
  -- Anyone still waiting on us at the end of the shift.
  still_waiting text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One note per person per day. A second save of the same shift updates rather than duplicating,
-- because somebody adding to their note at the end of the day should not produce two records that
-- disagree.
CREATE UNIQUE INDEX IF NOT EXISTS handover_notes_shift_key
  ON yp_labs.handover_notes (staff_id, shift_date);
CREATE INDEX IF NOT EXISTS handover_notes_date_idx
  ON yp_labs.handover_notes (shift_date DESC);
