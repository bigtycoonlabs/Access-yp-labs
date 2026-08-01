// Clay's cross-session memory — ported in spirit from Arbo's memory layer.
//
// Durable facts Clay chooses to remember about a builder (their stated goals, constraints,
// preferences) that persist across every session, so Clay greets a returning builder as
// someone he knows instead of meeting them cold. The builder OWNS this memory: they can ask
// Clay to forget one fact or wipe all of it, and one call erases everything.
//
// Safety: only readable text lives here. Clay is instructed never to store secrets, passwords,
// or payment data, and the value is length-capped so a runaway model can't write unbounded
// text. A fact marked 'private' is shown to the builder and to Clay, never to staff.
//
// Nothing here can spend money, publish, or delete a concept — it only reads and writes
// remembered text scoped to one user_id.

const { query } = require('../../config/db');

const KEY_MAX = 80;
const VALUE_MAX = 500;
const DEFAULT_LIMIT = 40;

async function getMemories(userId, limit = DEFAULT_LIMIT) {
  if (!userId) return [];
  const r = await query(
    `SELECT memory_key, memory_value, sensitivity, source, updated_at
       FROM clay_memory WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2`,
    [userId, limit],
  );
  return r.rows.map((row) => ({
    key: row.memory_key,
    value: row.memory_value,
    sensitivity: row.sensitivity === 'private' ? 'private' : 'normal',
    source: row.source || null,
    updatedAt: row.updated_at,
  }));
}

// Upsert a remembered fact. Value/key are capped; a re-remember updates in place.
async function rememberFact(userId, key, value, opts = {}) {
  if (!userId) return false;
  const k = String(key || '').trim().slice(0, KEY_MAX);
  const v = String(value || '').trim().slice(0, VALUE_MAX);
  if (!k || !v) return false;
  const sensitivity = opts.sensitivity === 'private' ? 'private' : 'normal';
  const source = opts.source ? String(opts.source).slice(0, 40) : null;
  await query(
    `INSERT INTO clay_memory (user_id, memory_key, memory_value, sensitivity, source)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, memory_key)
     DO UPDATE SET memory_value = EXCLUDED.memory_value, sensitivity = EXCLUDED.sensitivity,
                   source = EXCLUDED.source, updated_at = now()`,
    [userId, k, v, sensitivity, source],
  );
  return true;
}

// Forget one fact by key — the fine-grained half of the builder's control over their memory.
async function forgetFact(userId, key) {
  if (!userId) return false;
  const k = String(key || '').trim().slice(0, KEY_MAX);
  if (!k) return false;
  const r = await query(`DELETE FROM clay_memory WHERE user_id = $1 AND memory_key = $2 RETURNING id`, [userId, k]);
  return r.rows.length > 0;
}

// Wipe everything Clay remembers about this builder. Returns the count removed so the builder
// can be told exactly what was cleared.
async function clearMemory(userId) {
  if (!userId) return 0;
  const r = await query(`DELETE FROM clay_memory WHERE user_id = $1 RETURNING id`, [userId]);
  return r.rows.length;
}

// THE STAFF SAFETY BOUNDARY. What a staff member may see of a builder's remembered facts:
// non-private facts only. Private facts are never returned, only counted, so staff can know
// memory exists without reading what the builder shared in confidence. Pure, so it can never
// leak more than it returns.
function redactedMemoryForAdmin(items) {
  const list = items || [];
  const shown = list.filter((m) => m.sensitivity !== 'private');
  return {
    facts: shown,
    privateCount: list.length - shown.length,
    note: 'Redacted for staff. Private notes are never shown here, and Clay never stores secrets or payment data — the builder and Clay see the full picture, staff do not.',
  };
}

// Render remembered facts into a context block for Clay's system prompt. Pure (no DB), so the
// agent can stay decoupled from the database — the route loads the facts and passes the string.
function renderMemoryContext(items) {
  if (!items || !items.length) return '';
  const lines = items.slice(0, DEFAULT_LIMIT).map((m) => `- ${m.key}: ${m.value}`);
  return (
    'WHAT YOU REMEMBER ABOUT THIS BUILDER (carried from past sessions — treat them as someone ' +
    'you already know, use these to help, and do NOT re-ask what you already know here):\n' +
    lines.join('\n')
  );
}

module.exports = {
  getMemories,
  rememberFact,
  forgetFact,
  clearMemory,
  redactedMemoryForAdmin,
  renderMemoryContext,
  KEY_MAX,
  VALUE_MAX,
};
