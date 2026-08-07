// RECORDING WHAT HAPPENS IN A CONVERSATION.
//
// Nothing was stored before this. Every conversation was discarded the moment it ended, so the only
// evidence of how the product works was what got CREATED — which shows where somebody stopped and
// never why. Four projects stalled in the identical state and nobody could see what was said before
// the silence.
//
// Three rules this holds to, because a chat log is among the most sensitive things a platform can
// hold and "we need the data" is exactly the argument that erodes them:
//   1. RECORDING NEVER BREAKS THE CONVERSATION. Every function here swallows its own errors. If the
//      database is unhappy, the person still gets their answer — analytics must never cost someone
//      the thing they came for.
//   2. STAFF SEE SHAPE, NOT CONTENT. The staff view reports how long sessions ran, where they ended
//      and what failed. Reading someone's actual words is not a staff capability, and there is no
//      route that exposes them.
//   3. A CREATOR CAN ERASE IT. Their history is theirs, and deleting it deletes it.

const { query } = require('../../config/db');

// Start or continue a session. A conversation that resumes within the hour is the same
// conversation — someone stepping away to think is not a new visit, and counting it as one would
// make the numbers say people bounce when they are actually working.
async function openSession({ userId, conceptId = null, surface = 'laboratory' } = {}) {
  try {
    if (!userId) return null;
    const recent = await query(
      `SELECT id FROM clay_sessions
        WHERE user_id = $1 AND surface = $2
          AND concept_id IS NOT DISTINCT FROM $3
          AND last_at > now() - interval '60 minutes'
        ORDER BY last_at DESC LIMIT 1`, [userId, surface, conceptId]);
    if (recent.rows.length) return recent.rows[0].id;
    const r = await query(
      `INSERT INTO clay_sessions (user_id, concept_id, surface) VALUES ($1,$2,$3) RETURNING id`,
      [userId, conceptId, surface]);
    return r.rows[0].id;
  } catch (e) {
    console.error('could not open a Clay session:', e && e.message);
    return null;
  }
}

// One exchange: what they said, what Clay said back, and how it actually resolved.
async function recordTurn({ sessionId, userText, clayText, status, tools = [], toolFailed = false } = {}) {
  if (!sessionId) return;
  try {
    if (userText) {
      await query(
        `INSERT INTO clay_messages (session_id, role, content) VALUES ($1,'user',$2)`,
        [sessionId, String(userText).slice(0, 20000)]);
    }
    await query(
      `INSERT INTO clay_messages (session_id, role, content, status, tools_used, tool_failed)
       VALUES ($1,'clay',$2,$3,$4,$5)`,
      [sessionId, String(clayText || '').slice(0, 40000), status || null, tools, !!toolFailed]);
    await query(
      `UPDATE clay_sessions
          SET turns = turns + 1, last_at = now(), last_status = $2, last_tool = $3
        WHERE id = $1`,
      [sessionId, status || null, tools.length ? tools[tools.length - 1] : null]);
  } catch (e) {
    console.error('could not record a Clay turn:', e && e.message);
  }
}

// WHERE PEOPLE STOP. The question this whole thing exists to answer.
//
// A session is "abandoned" when nothing followed it for a day. What matters is not the count but
// what was on screen when it went quiet: the last status, the last tool, and how far in.
async function stopPoints({ days = 30 } = {}) {
  const r = await query(
    `SELECT
       COUNT(*)::int AS sessions,
       COUNT(*) FILTER (WHERE turns = 1)::int AS one_turn_only,
       COUNT(*) FILTER (WHERE last_status <> 'answered')::int AS ended_on_a_failure,
       ROUND(AVG(turns)::numeric, 1) AS avg_turns
     FROM clay_sessions
     WHERE started_at > now() - ($1 || ' days')::interval`, [String(days)]);

  // The last thing that happened before each silence, grouped.
  const endings = await query(
    `SELECT COALESCE(last_tool, '(just talking)') AS last_tool,
            COALESCE(last_status, 'unknown') AS last_status,
            COUNT(*)::int AS n
       FROM clay_sessions
      WHERE started_at > now() - ($1 || ' days')::interval
        AND last_at < now() - interval '24 hours'
      GROUP BY 1,2 ORDER BY n DESC LIMIT 12`, [String(days)]);

  // Projects that stalled, and what state they stalled in — the pattern that started this.
  const stalled = await query(
    `SELECT c.movement_state, c.stage, COUNT(*)::int AS n,
            ROUND(AVG(EXTRACT(EPOCH FROM (now() - c.updated_at)) / 86400)::numeric, 1) AS avg_days_quiet
       FROM concepts c
       JOIN users u ON u.id = c.owner_id
      WHERE u.email <> 'clay@accessyplabs.com'
        AND c.updated_at < now() - interval '3 days'
      GROUP BY 1,2 ORDER BY n DESC`);

  return { window_days: days, ...r.rows[0], ended_on: endings.rows, stalled_projects: stalled.rows };
}

// A creator erasing their own history. Theirs to delete, and it goes for real.
async function forgetMine(userId) {
  try {
    const r = await query('DELETE FROM clay_sessions WHERE user_id = $1 RETURNING id', [userId]);
    return { ok: true, sessions_deleted: r.rowCount || 0 };
  } catch (e) {
    return { ok: false, error: e && e.message };
  }
}

module.exports = { openSession, recordTurn, stopPoints, forgetMine };
