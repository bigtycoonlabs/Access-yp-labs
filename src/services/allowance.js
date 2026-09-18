// ALLOWANCES. What a person may still do this month, and counting what they did.
//
// The plans page lists a monthly allowance for each plan; this is what makes those numbers true.
//   - check() is asked BEFORE new work: a Penny turn, a build, a compliance search.
//   - record() is called AFTER the work happened, so a failed build or a reused finding costs nothing.
//   - Beyond the month's allowance, work draws on top-up units, which last until used.
//   - Only new work pauses. Sites, portals, files and anything already running never stop.
//   - Staff, and people on retired plans (sold as unlimited), are never limited.
// If the allowance cannot be read, the work is allowed and the failure logged: a database hiccup must
// not lock a paying customer out of their own assistant.

const { query } = require('../config/db');
const { PLANS, FREE_ALLOWANCE, PAID_PLANS, TOPUPS } = require('../lib/money');
const { billingExempt } = require('../lib/entitlement');

// Which allowance each counted kind reads.
const FIELD = {
  penny_message: 'penny_messages',
  build: 'builds',
  compliance_review: 'compliance_reviews',
  compliance_question: 'compliance_questions',
};
const WORDS = {
  penny_message: ['message', 'messages'],
  build: ['build', 'builds'],
  compliance_review: ['full compliance review', 'full compliance reviews'],
  compliance_question: ['compliance question', 'compliance questions'],
};
const word = (kind, n) => WORDS[kind][n === 1 ? 0 : 1];

function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function planOf(user) {
  if (billingExempt(user)) return { plan: 'staff', unlimited: true };
  const r = await query(
    `SELECT plan FROM subscriptions WHERE user_id=$1 AND status='active' AND plan = ANY($2)
       AND (current_period_end IS NULL OR current_period_end > now())
     ORDER BY (plan='office') DESC, (plan='desk') DESC LIMIT 1`, [user.id, PAID_PLANS]);
  const plan = r.rows[0] ? r.rows[0].plan : 'free';
  if (plan === 'builder' || plan === 'sculptor') return { plan, unlimited: true };
  return { plan, unlimited: false, allowance: plan === 'free' ? FREE_ALLOWANCE : PLANS[plan].allowance };
}

async function status(user, kind) {
  const p = await planOf(user);
  if (p.unlimited) return { kind, plan: p.plan, unlimited: true, ok: true };
  const included = Number(p.allowance[FIELD[kind]] || 0);
  const used = Number((await query(
    `SELECT count(*)::int AS n FROM usage_events WHERE user_id=$1 AND kind=$2 AND from_topup=false AND created_at >= $3`,
    [user.id, kind, monthStart()])).rows[0].n);
  // Full reviews have no top-up: a person who needs more asks single questions, or moves to Office.
  const topup = TOPUPS[kind] ? Number(((await query(
    'SELECT units FROM topup_balances WHERE user_id=$1 AND kind=$2', [user.id, kind])).rows[0] || {}).units || 0) : 0;
  const left = Math.max(0, included - used);
  return { kind, plan: p.plan, unlimited: false, included, used: Math.min(used, included), left, topup,
    ok: left > 0 || topup > 0 };
}

function refusal(s) {
  const planName = s.plan === 'free' ? 'the free plan' : (PLANS[s.plan] ? PLANS[s.plan].name : 'your plan');
  let says = 'You have used all ' + s.included + ' ' + word(s.kind, s.included) + ' included with ' + planName
    + ' this month, so I have not started this. Nothing you already have has stopped.';
  if (s.kind === 'compliance_review') {
    says += s.plan === 'office' ? ' A new month brings more, and you can still ask me single compliance questions.'
      : ' Office includes reviews for up to three businesses, or you can ask me single compliance questions.';
  } else {
    says += ' A $10 top-up adds ' + TOPUPS[s.kind].label + '.';
  }
  says += ' Plans and top-ups are at https://accessyplabs.com/plans.html.';
  return says;
}

// Before new work. Returns { ok: true } or { ok: false, says }. Never throws.
// WHOSE PLAN PAYS. Somebody working in a team they were added to spends that owner's allowance, not
// their own: the owner invited them, the owner's plan covers the work. Standing in their own work, it
// is theirs. Read here rather than at each call site, so no path can forget it.
async function payer(user) {
  try { return await require('./clay/views').billTo(user); } catch (_) { return user; }
}

async function check(user, kind) {
  try {
    const s = await status(await payer(user), kind);
    return s.ok ? { ok: true, status: s } : { ok: false, kind: 'refused', says: refusal(s), status: s };
  } catch (e) {
    console.error('[allowance] could not read the ' + kind + ' allowance for ' + (user && user.id) + ': ' + e.message);
    return { ok: true, unread: true };
  }
}

// After the work happened. Counts against the month, or against a top-up once the month is used up.
// Never throws; a failure to count is logged.
async function record(user, kind, ref) {
  try {
    const who = await payer(user);
    const s = await status(who, kind);
    let fromTopup = false;
    if (!s.unlimited && s.left <= 0 && s.topup > 0) {
      const took = await query(
        `UPDATE topup_balances SET units = units - 1, updated_at = now() WHERE user_id=$1 AND kind=$2 AND units > 0 RETURNING units`,
        [who.id, kind]);
      fromTopup = took.rows.length > 0;
    }
    await query('INSERT INTO usage_events (user_id, kind, from_topup, ref) VALUES ($1,$2,$3,$4)',
      [who.id, kind, fromTopup, ref ? String(ref).slice(0, 200) : null]);
    return { counted: true, from_topup: fromTopup };
  } catch (e) {
    console.error('[allowance] could not count a ' + kind + ' for ' + (user && user.id) + ': ' + e.message);
    return { counted: false };
  }
}

// A sentence for when something is nearly used up, or null.
function lowNote(s) {
  if (!s || s.unlimited || s.included === 0) return null;
  const remaining = s.left + s.topup;
  if (remaining === 0 || remaining > Math.max(1, Math.floor(s.included * 0.1))) return null;
  return 'You have ' + remaining + ' ' + word(s.kind, remaining) + ' left this month'
    + (s.topup ? ', including top-ups' : '') + '.';
}

async function summary(user) {
  const out = {};
  for (const k of Object.keys(FIELD)) out[k] = await status(user, k);
  return out;
}

async function addTopup({ sessionId, userId, kind, priceCents }) {
  if (!TOPUPS[kind]) return { added: false, says: 'Unknown top-up.' };
  const ins = await query(
    `INSERT INTO topup_purchases (stripe_session_id, user_id, kind, units, price_cents)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (stripe_session_id) DO NOTHING RETURNING id`,
    [sessionId, userId, kind, TOPUPS[kind].units, priceCents || 0]);
  if (!ins.rows.length) return { added: false, says: 'Already added.' };
  await query(
    `INSERT INTO topup_balances (user_id, kind, units) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, kind) DO UPDATE SET units = topup_balances.units + EXCLUDED.units, updated_at = now()`,
    [userId, kind, TOPUPS[kind].units]);
  return { added: true, units: TOPUPS[kind].units };
}

module.exports = { FIELD, monthStart, planOf, status, check, record, lowNote, summary, addTopup, refusal };
