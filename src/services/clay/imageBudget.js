// Per-concept image accounting. Turns the rules in lib/imageCredits into live numbers from the
// database: how many images this concept has used this month, how many purchased pack credits it
// has, and whether another image can be made. Consuming an image spends the monthly allowance
// first, then a purchased credit — atomically, so a paid credit is never double-spent.

const { query } = require('../../config/db');
const credits = require('../../lib/imageCredits');

// A concept's owner is Sculptor if they hold an active sculptor subscription (same test the
// entitlement layer uses); otherwise base.
async function planFor(ownerId) {
  if (!ownerId) return 'base';
  const r = await query(
    "SELECT 1 FROM subscriptions WHERE user_id=$1 AND plan='sculptor' AND status='active' LIMIT 1", [ownerId]);
  return r.rows.length ? 'sculptor' : 'base';
}

async function usedThisMonth(conceptId) {
  const r = await query(
    "SELECT COUNT(*)::int AS n FROM image_generations WHERE concept_id=$1 AND created_at >= date_trunc('month', now())",
    [conceptId]);
  return r.rows[0].n;
}

async function purchasedBalance(conceptId) {
  const r = await query('SELECT balance FROM concept_image_credits WHERE concept_id=$1', [conceptId]);
  return r.rows.length ? r.rows[0].balance : 0;
}

// Has this concept already had images made automatically? Used to keep auto-generation to a
// concept's first build only, so enhancements don't quietly spend the allowance.
async function hasAutoImages(conceptId) {
  const r = await query("SELECT 1 FROM image_generations WHERE concept_id=$1 AND source='auto' LIMIT 1", [conceptId]);
  return r.rows.length > 0;
}

// The full picture for a concept (used this month, free remaining, purchased balance, can_generate).
async function budgetFor(conceptId, ownerId, planOverride) {
  const plan = planOverride || await planFor(ownerId);
  const [used, purchased] = await Promise.all([usedThisMonth(conceptId), purchasedBalance(conceptId)]);
  return credits.budget({ plan, usedThisMonth: used, purchased });
}

// Consume ONE image: free first (within the monthly allowance), else a purchased credit (atomic
// decrement). Logs the generation. Returns { ok, billed } or { ok:false, reason:'no_credits' }.
async function consumeOne(conceptId, ownerId, opts = {}) {
  const { source = 'auto', altText = null, storageRef = null } = opts;
  const plan = opts.plan || await planFor(ownerId);
  const included = credits.monthlyIncluded(plan);
  const used = await usedThisMonth(conceptId);
  let billed;
  if (used < included) {
    billed = 'free';
  } else {
    const dec = await query(
      'UPDATE concept_image_credits SET balance=balance-1, updated_at=now() WHERE concept_id=$1 AND balance>0 RETURNING balance',
      [conceptId]);
    if (!dec.rows.length) return { ok: false, reason: 'no_credits' };
    billed = 'paid';
  }
  await query(
    'INSERT INTO image_generations (concept_id, user_id, source, billed, alt_text, storage_ref) VALUES ($1,$2,$3,$4,$5,$6)',
    [conceptId, ownerId || null, source, billed, altText, storageRef]);
  return { ok: true, billed };
}

// Add purchased pack credits to a concept (called after a successful Extras purchase).
async function grantCredits(conceptId, images) {
  if (!(images > 0)) return;
  await query(
    `INSERT INTO concept_image_credits (concept_id, balance) VALUES ($1,$2)
     ON CONFLICT (concept_id) DO UPDATE SET balance=concept_image_credits.balance + EXCLUDED.balance, updated_at=now()`,
    [conceptId, images]);
}

module.exports = { planFor, usedThisMonth, purchasedBalance, hasAutoImages, budgetFor, consumeOne, grantCredits };
