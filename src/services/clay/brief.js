const { query } = require('../../config/db');
const provider = require('./provider');

// The four scannable brief fields, kept short so they read at a glance on a card and a listing.
const FIELDS = ['problem', 'customer', 'earning', 'why_you'];
const CAP = 240;

function clean(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  return t.length > CAP ? t.slice(0, CAP).trim() : t;
}

// Defensive parse: accept only the four known fields, trimmed and capped; drop everything else.
function parseBrief(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  for (const f of FIELDS) { const v = clean(obj[f]); if (v) out[f] = v; }
  return Object.keys(out).length ? out : null;
}

function parseModelJson(text) {
  const t = String(text || '').trim();
  const start = t.indexOf('{'); const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch (_) { return null; }
}

const SYSTEM = `You are Clay, writing a tight opportunity brief for a business concept listed on the Dream Market. Someone browsing wants to know at a glance: what problem it solves, who they'd serve, what they could realistically make, and why it might be them. Return a SINGLE JSON object and nothing else:
{
  "problem": string,   // the real pain this answers, in one plain sentence.
  "customer": string,  // who they'd serve — the specific customer base — in one sentence, grounded in the research provided.
  "earning": string,   // an HONEST one-line read of the money potential, grounded ONLY in the computed economics provided. Never invent figures. If the economics don't support a precise number, describe the shape honestly (e.g. "a few hundred to low thousands a month at modest scale"), never a false precise figure.
  "why_you": string    // why this could be the right one for THEM to run — the angle that makes it winnable — in one sentence. Honest, never hype.
}
Each value is one short sentence, under 240 characters, plain and speakable. Ground every line in the material provided; do not fabricate. Do not wrap the JSON in markdown fences.`;

async function generateBrief({ title, category, clays_take, risk_summary, economics, customer }) {
  if (!provider.available()) return null;
  const user = `CONCEPT: ${title || 'Untitled'}${category ? ` (category: ${category})` : ''}

CLAY'S TAKE (the narrative):
${(clays_take || '(none)').slice(0, 2000)}

RISK SUMMARY:
${(risk_summary || '(none)').slice(0, 800)}

COMPUTED ECONOMICS (the only basis for the earning line — do not invent beyond this):
${(economics || '(none available — describe the earning shape honestly and generally)').slice(0, 2500)}

CUSTOMER RESEARCH (the basis for the customer line):
${(customer || '(none)').slice(0, 2000)}`;
  try {
    const out = await provider.complete({ system: SYSTEM, user, json: true, maxTokens: 700 });
    if (!out || !out.ok) return null;
    return parseBrief(parseModelJson(out.text));
  } catch (_) { return null; }
}

// Load a concept's grounding material, generate the brief, and store it. Owner-scoping is the
// caller's responsibility. Best-effort: returns the brief, or null if it couldn't be produced.
async function ensureBriefFor(conceptId) {
  const c = (await query(
    'SELECT id, title, category, clays_take, risk_summary FROM concepts WHERE id=$1', [conceptId])).rows[0];
  if (!c) return null;
  const econ = (await query(
    "SELECT body FROM assets WHERE concept_id=$1 AND type='money_flow' AND is_current ORDER BY created_at DESC LIMIT 1", [conceptId])).rows[0];
  const cust = (await query(
    "SELECT body FROM assets WHERE concept_id=$1 AND type='customer_research' AND is_current ORDER BY created_at DESC LIMIT 1", [conceptId])).rows[0];
  const brief = await generateBrief({
    title: c.title, category: c.category, clays_take: c.clays_take, risk_summary: c.risk_summary,
    economics: econ && econ.body, customer: cust && cust.body,
  });
  if (!brief) return null;
  await query('UPDATE concepts SET brief=$2::jsonb, updated_at=NOW() WHERE id=$1', [conceptId, JSON.stringify(brief)]);
  return brief;
}

module.exports = { FIELDS, parseBrief, generateBrief, ensureBriefFor };
