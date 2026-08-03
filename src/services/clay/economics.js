// Turns a concept's money_flow section from model-WRITTEN numbers into COMPUTED ones. Clay supplies
// estimated assumptions (clearly labelled as estimates and grounded in the concept's own plan); the
// platform does the arithmetic in src/lib/economics.js. Additive — this never touches the build path.
// Defensive throughout: if the model isn't available or its output can't be parsed, nothing changes
// and no figure is invented.

const { query, getClient } = require('../../config/db');
const provider = require('./provider');
const { computeUnitEconomics } = require('../../lib/economics');

const NUM_KEYS = ['price_per_unit', 'unit_cost', 'payment_fee_pct', 'monthly_fixed_costs',
  'startup_cost', 'expected_units_per_month', 'cac', 'monthly_churn_pct'];

// Ask Clay for STRUCTURED numeric assumptions for a concept, grounded in its own plan. Returns null
// (never a guess) if unavailable or unparseable. Coerces values to real numbers.
async function deriveAssumptions(concept, context) {
  if (!provider.available()) return null;
  const system = 'You are Clay. Read the business concept and give your BEST NUMERIC ESTIMATES for its '
    + 'unit economics as JSON. Estimates are expected and fine — downstream code does the real math, so '
    + 'never round to look neat. Use realistic small-business figures in US dollars. Respond with ONLY a JSON object.';
  const user = 'Concept: ' + (concept.title || 'Untitled') + ' (' + (concept.category || 'general') + ').\n'
    + (context ? ('Its plan says:\n' + String(context).slice(0, 4000) + '\n\n') : '')
    + 'Return JSON with these keys (numbers only; omit any you genuinely cannot estimate):\n'
    + '{ "price_per_unit": number, "unit_cost": number, "payment_fee_pct": number, '
    + '"monthly_fixed_costs": number, "startup_cost": number, "expected_units_per_month": number, '
    + '"cac": number, "monthly_churn_pct": number, '
    + '"unit_label": short word for one sale (e.g. "sale", "subscription", "booking"), '
    + '"basis": one sentence on where these estimates come from }.';
  const out = await provider.complete({ system, user, json: true, maxTokens: 500, effort: 'low' });
  if (!out || !out.ok) return null;
  let p; try { p = JSON.parse(out.text); } catch (_) { return null; }
  if (!p || typeof p !== 'object') return null;
  for (const k of NUM_KEYS) {
    if (p[k] != null && p[k] !== '') { const v = Number(p[k]); p[k] = Number.isFinite(v) ? v : undefined; }
    else p[k] = undefined;
  }
  return p;
}

const MONEY = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const PCT = (n) => (n == null ? '—' : n + '%');
const NUM = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));

// A calm, screen-reader-friendly body: what was ASSUMED (estimates) vs what was COMPUTED (real math).
function formatEconomicsBody(assumptions, computed, unitLabel) {
  const u = unitLabel || 'unit';
  const A = assumptions || {};
  const lines = [];
  lines.push('UNIT ECONOMICS (COMPUTED)');
  lines.push('');
  lines.push('These figures are calculated by the platform, not written by the model. The assumptions below are Clay’s best estimates; every number after them follows by arithmetic, so each one can be checked.');
  if (A.basis) { lines.push(''); lines.push('Basis: ' + String(A.basis)); }
  lines.push('');
  lines.push('Assumptions (estimated):');
  lines.push('- Price per ' + u + ': ' + MONEY(A.price_per_unit));
  lines.push('- Variable cost per ' + u + ': ' + MONEY(A.unit_cost));
  if (A.payment_fee_pct != null) lines.push('- Payment processing fee: ' + PCT(A.payment_fee_pct));
  lines.push('- Monthly fixed costs: ' + MONEY(A.monthly_fixed_costs));
  lines.push('- One-time startup cost: ' + MONEY(A.startup_cost));
  lines.push('- Expected ' + u + 's per month: ' + NUM(A.expected_units_per_month));
  if (A.cac != null) lines.push('- Customer acquisition cost: ' + MONEY(A.cac));
  if (A.monthly_churn_pct != null) lines.push('- Monthly churn: ' + PCT(A.monthly_churn_pct));
  lines.push('');
  lines.push('Computed figures (real math):');
  lines.push('- Contribution margin per ' + u + ': ' + MONEY(computed.contribution_margin_per_unit)
    + (computed.gross_margin_pct != null ? ' (' + computed.gross_margin_pct + '% margin)' : ''));
  if (computed.break_even_units_per_month != null) {
    lines.push('- Break-even: ' + NUM(computed.break_even_units_per_month) + ' ' + u + 's per month ('
      + MONEY(computed.break_even_revenue_per_month) + ' in revenue)');
  }
  if (computed.monthly_revenue_at_expected != null) lines.push('- Monthly revenue at expected volume: ' + MONEY(computed.monthly_revenue_at_expected));
  if (computed.monthly_operating_profit_at_expected != null) lines.push('- Monthly operating profit at expected volume: ' + MONEY(computed.monthly_operating_profit_at_expected));
  if (computed.annual_operating_profit_at_expected != null) lines.push('- Annual operating profit at expected volume: ' + MONEY(computed.annual_operating_profit_at_expected));
  if (computed.payback_months != null) lines.push('- Payback on the startup cost: ' + computed.payback_months + ' months');
  if (computed.ltv != null) {
    lines.push('- Customer lifetime value: ' + MONEY(computed.ltv)
      + (computed.ltv_cac_ratio != null ? ' (LTV to CAC ratio ' + computed.ltv_cac_ratio + ' to 1)' : ''));
  }
  if (computed.warnings && computed.warnings.length) {
    lines.push('');
    lines.push('Notes:');
    computed.warnings.forEach((w) => lines.push('- ' + w));
  }
  return lines.join('\n');
}

// Pull the concept's plan + current money_flow to ground the estimates.
async function conceptContext(conceptId) {
  const r = await query(
    "SELECT body FROM assets WHERE concept_id=$1 AND is_current=true AND type IN ('business_plan','money_flow')",
    [conceptId]);
  return r.rows.map((row) => row.body).filter(Boolean).join('\n\n').slice(0, 4000);
}

// Compute a concept's economics and upgrade its money_flow section: computed block on top, the prior
// narrative preserved beneath, as a new version (history kept). Returns an honest result; never throws.
async function computeAndAttach(conceptId) {
  const c = await query('SELECT id, title, category FROM concepts WHERE id=$1', [conceptId]);
  if (!c.rows.length) return { ok: false, reason: 'not_found' };
  const concept = c.rows[0];
  const context = await conceptContext(conceptId);
  const assumptions = await deriveAssumptions(concept, context);
  if (!assumptions) return { ok: false, reason: 'unavailable' };
  const computed = computeUnitEconomics(assumptions);
  const unitLabel = (typeof assumptions.unit_label === 'string' && assumptions.unit_label.trim())
    ? assumptions.unit_label.trim().slice(0, 24) : 'unit';
  const block = formatEconomicsBody(assumptions, computed, unitLabel);

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      "SELECT title, body FROM assets WHERE concept_id=$1 AND type='money_flow' AND is_current=true LIMIT 1", [conceptId]);
    const mx = await client.query(
      "SELECT COALESCE(MAX(version),0) AS maxv FROM assets WHERE concept_id=$1 AND type='money_flow'", [conceptId]);
    const priorBody = cur.rows.length ? (cur.rows[0].body || '') : '';
    const title = (cur.rows.length && cur.rows[0].title) ? cur.rows[0].title : 'Payments, pricing & unit economics';
    const nextVersion = (mx.rows[0].maxv || 0) + 1;
    const newBody = block + (priorBody ? '\n\n---\n\n' + priorBody : '');
    if (cur.rows.length) {
      await client.query("UPDATE assets SET is_current=false WHERE concept_id=$1 AND type='money_flow' AND is_current=true", [conceptId]);
    }
    await client.query(
      `INSERT INTO assets (concept_id, type, title, body, is_baseline, scan_status, version, is_current)
       VALUES ($1,'money_flow',$2,$3,false,'not_required',$4,true)`,
      [conceptId, title, newBody, nextVersion]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    return { ok: false, reason: 'persist_failed', error: e.message };
  } finally { client.release(); }

  return { ok: true, body: block, computed, assumptions, unit_label: unitLabel };
}

module.exports = { computeAndAttach, deriveAssumptions, formatEconomicsBody };
