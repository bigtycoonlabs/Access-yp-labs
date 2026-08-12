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

// ── Derived patterns (read-only signals from real work) ────────────────────
// Facts computed from the builder's actual concepts — how many, which category they concentrate
// in, what they've listed or are operating — so Clay stays relevant and picks up where they are.
// These are grounded in real rows, never psychoanalysis: Clay is told to use them for relevance,
// not to read motivation into them and never to nag.

function daysSince(ts) {
  if (!ts) return null;
  return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
}

// A CLEAR focus is a single category that is both the most common and strictly ahead of the next —
// a tie or a lone concept is not a pattern, so we say nothing rather than overclaim one.
function focusCategory(categoryCounts) {
  if (!Array.isArray(categoryCounts) || !categoryCounts.length) return null;
  const top = categoryCounts[0];
  if (!top || top.n < 2) return null;
  const next = categoryCounts[1];
  return (!next || top.n > next.n) ? top.category : null;
}

async function getPatterns(userId) {
  if (!userId) return null;
  const agg = await query(
    `SELECT
       (SELECT count(*)::int FROM concepts WHERE owner_id=$1) AS concept_count,
       (SELECT count(*)::int FROM concepts WHERE owner_id=$1 AND is_operating=true) AS operating_count,
       (SELECT count(*)::int FROM listings WHERE seller_id=$1 AND status <> 'withdrawn') AS listed_count,
       (SELECT max(GREATEST(COALESCE(last_opened_at, to_timestamp(0)), updated_at)) FROM concepts WHERE owner_id=$1) AS last_active,
       (SELECT created_at FROM users WHERE id=$1) AS created_at`,
    [userId]);
  const cats = await query(
    `SELECT category, count(*)::int AS n FROM concepts WHERE owner_id=$1 AND category IS NOT NULL GROUP BY category ORDER BY n DESC`,
    [userId]);
  // How this creator actually likes to operate, read from the paths they've chosen across concepts:
  // refining ideas to sell, building to launch and keep, or both. Behavioral, not self-reported.
  const paths = await query(
    `SELECT path, count(*)::int AS n FROM concept_intents
      WHERE user_id=$1 AND path IN ('build_myself','refine_to_sell') GROUP BY path`,
    [userId]);
  let sells = 0; let launches = 0;
  for (const r of paths.rows) { if (r.path === 'refine_to_sell') sells = r.n; else if (r.path === 'build_myself') launches = r.n; }
  let disposition = null;
  if (sells && launches) disposition = 'both';
  else if (sells) disposition = 'sells';
  else if (launches) disposition = 'launches';
  const row = agg.rows[0] || {};
  const categoryCounts = cats.rows.map((r) => ({ category: r.category, n: r.n }));
  return {
    conceptCount: row.concept_count || 0,
    operatingCount: row.operating_count || 0,
    listedCount: row.listed_count || 0,
    disposition,
    categoryFocus: focusCategory(categoryCounts),
    categoryCounts,
    daysSinceLastActive: daysSince(row.last_active),
    accountAgeDays: daysSince(row.created_at) || 0,
  };
}

// Render the patterns as neutral context. Nothing to say for a brand-new builder with no concepts.
function renderPatterns(p) {
  if (!p || !p.conceptCount) return '';
  const bits = [`They have ${p.conceptCount} concept${p.conceptCount === 1 ? '' : 's'} in their Laboratory`];
  if (p.categoryFocus) bits.push(`concentrated in ${String(p.categoryFocus).replace(/_/g, ' ')}`);
  if (p.listedCount) bits.push(`${p.listedCount} put on the Exchange`);
  if (p.operatingCount) bits.push(`${p.operatingCount} already operating`);
  let facts = bits.join(', ') + '.';
  if (p.disposition === 'both') facts += ' Across their concepts they both refine ideas to sell AND build ideas to launch themselves — a do-it-all creator; coach both sides.';
  else if (p.disposition === 'sells') facts += ' So far they lean toward refining ideas to sell in the Exchange — coach toward a sellable, packaged concept, while staying open if they signal a different aim.';
  else if (p.disposition === 'launches') facts += ' So far they lean toward building ideas to launch and run themselves — coach toward proof, first customers, and going live, not toward a sale.';
  if (p.operatingCount) facts += ' Some of their concepts are businesses they already run, so part of the work here is growing what already exists, not only shaping something new.';
  if (p.daysSinceLastActive != null && p.daysSinceLastActive >= 14) {
    facts += ` It's been about ${p.daysSinceLastActive} days since they last opened one.`;
  }
  return (
    'THE SHAPE OF THEIR WORK SO FAR (derived from their real concepts — use it to stay relevant, ' +
    'lean into what they care about, and pick up where they are; do NOT read motivation into it, ' +
    'and never nag):\n' + facts
  );
}

module.exports = {
  getMemories,
  rememberFact,
  forgetFact,
  clearMemory,
  redactedMemoryForAdmin,
  renderMemoryContext,
  focusCategory,
  getPatterns,
  renderPatterns,
  KEY_MAX,
  VALUE_MAX,
};
