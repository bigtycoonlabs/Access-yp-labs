const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../lib/http');
const { PLANS, planCents, yearlyCents, PAID_PLANS, BUNDLES, bundleYearlyCents } = require('../lib/money');
const { isStaff, billingExempt } = require('../lib/entitlement');
const stripe = require('../services/stripe');
const router = express.Router();

// Begin checkout for a plan. Maker is per-concept; Sculptor is unlimited.
// A subscription becomes active only via the verified webhook after real
// payment — never created unpaid here. Staff never pay.
router.post('/', authenticate, [
  // Only the plans on sale. An old screen still asking for 'builder' is answered with Desk, which
  // replaced it; nothing is charged at the retired price.
  body('bundle').optional({ values: 'falsy' }).isIn(Object.keys(BUNDLES)),
  // A bundle names its own Labs plan, so plan is filled in from it.
  body('plan').customSanitizer((v, { req }) => (req.body.bundle && BUNDLES[req.body.bundle]
    ? BUNDLES[req.body.bundle].labs : v === 'builder' ? 'desk' : v)).isIn(['desk', 'office']),
  body('billing').optional().isIn(['monthly', 'yearly']),
  body('concept_id').optional().isUUID(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  if (billingExempt(req.user)) {
    return res.json({ ok: false, reason: 'staff_exempt', message: 'Staff accounts have full access and are never charged.' });
  }
  const { plan } = req.body;
  const bundle = req.body.bundle && BUNDLES[req.body.bundle] ? req.body.bundle : null;
  const billing = req.body.billing === 'yearly' ? 'yearly' : 'monthly';
  let conceptId = req.body.concept_id || null;

  if (plan === 'maker') {
    if (!conceptId) return res.status(400).json({ error: 'Maker is a per-concept plan — a concept is required.' });
    const own = await query('SELECT id FROM concepts WHERE id=$1 AND owner_id=$2', [conceptId, req.user.id]);
    if (!own.rows.length) return res.status(404).json({ error: 'That project could not be found — it may have been removed, or it may not be yours.' });
  } else {
    conceptId = null; // Sculptor covers everything.
  }

  // Money-safety: never start a second paid checkout for coverage the user already has.
  // Sculptor covers every concept; Maker covers one. This prevents accidental
  // double-charging — tapping "Keep this concept" twice, or buying Maker when Sculptor
  // already covers it. Only 'active' blocks; a lapsed (past_due) plan can re-subscribe.
  const active = await query(
    "SELECT plan, concept_id FROM subscriptions WHERE user_id=$1 AND status='active'",
    [req.user.id]);
  // One paid plan per person. Switching between Desk and Office is not self-serve yet, and a second
  // checkout would charge twice, so it is refused with who to ask.
  const held = active.rows.find((r) => PAID_PLANS.includes(r.plan) && r.plan !== 'sculptor');
  if (held) {
    const name = PLANS[held.plan] ? PLANS[held.plan].name : 'a plan';
    return res.json({ ok: false, reason: 'already_covered',
      message: held.plan === plan && !bundle
        ? 'You already have ' + name + ', so there is nothing to buy and you will not be charged again.'
        : bundle
        ? 'You already have ' + name + '. Adding YP Flow as a bundle is not self-serve yet, so nothing was charged. Email success@accessyourplace.com and we will set it up without charging you twice.'
        : 'You already have ' + name + '. Changing plans is not self-serve yet, so nothing was charged. Email success@accessyourplace.com and we will switch it without charging you twice.' });
  }
  if (active.rows.some((r) => r.plan === 'sculptor')) {
    return res.json({ ok: false, reason: 'already_covered',
      message: 'You already have Sculptor, which covers unlimited concepts — there’s nothing to buy, and you won’t be charged again.' });
  }
  if (plan === 'maker' && active.rows.some((r) => r.plan === 'maker' && r.concept_id === conceptId)) {
    return res.json({ ok: false, reason: 'already_covered',
      message: 'You already have an active Maker plan for this concept — you won’t be charged again.' });
  }

  // Live Stripe rejects non-https return URLs. Only trust CLIENT_URL if it's https;
  // otherwise fall back to the real production origin so checkout can't be broken by a
  // missing or dev-value env var.
  const base = (process.env.CLIENT_URL || '').startsWith('https') ? process.env.CLIENT_URL : 'https://accessyplabs.com';
  const checkout = await stripe.createPlanCheckout({
    mode: 'subscription', billing, bundle, flowTier: bundle ? BUNDLES[bundle].flow : null,
    person: bundle ? (await query('SELECT name, phone FROM users WHERE id=$1', [req.user.id])).rows[0] : null,
    priceCents: bundle
      ? (billing === 'yearly' ? bundleYearlyCents(bundle) : BUNDLES[bundle].cents)
      : (billing === 'yearly' ? yearlyCents(plan) : planCents(plan)),
    planName: bundle
      ? BUNDLES[bundle].name + ' bundle: Access YP Labs and Access YP Flow' + (billing === 'yearly' ? ', yearly' : ', monthly')
      : 'Access YP Labs ' + PLANS[plan].name + (billing === 'yearly' ? ', yearly' : ', monthly'), plan,
    conceptId, userId: req.user.id, email: req.user.email,
    successUrl: `${base}/plans.html?sub=done`,
    cancelUrl: `${base}/plans.html?sub=canceled`,
  });
  if (!checkout.ok) {
    // Record the real Stripe reason so staff can read it on the dashboard (the operators are
    // blind and can't read Railway logs). Best-effort — a diagnostic write must never change
    // the outcome of the request. stripe_not_configured means no key at all, which we still log.
    try {
      await query(
        `INSERT INTO checkout_errors (user_id, kind, plan, concept_id, stripe_type, stripe_code, stripe_param, message)
         VALUES ($1,'plan',$2,$3,$4,$5,$6,$7)`,
        [req.user.id, plan, conceptId || null,
         checkout.stripe_type || (checkout.reason === 'stripe_not_configured' ? 'not_configured' : null),
         checkout.stripe_code || checkout.detail || null,
         checkout.stripe_param || null,
         checkout.stripe_message || checkout.reason || null]);
    } catch (_) { /* never let logging break the response */ }
    const msg = checkout.reason === 'stripe_not_configured'
      ? 'Billing is not configured on the platform yet, so nothing was charged.'
      : (checkout.message || 'Could not start checkout right now, so nothing was charged. Please try again.');
    return res.status(200).json({ ok: false, reason: checkout.reason, detail: checkout.detail || null, message: msg });
  }
  res.json({ ok: true, url: checkout.url });
}));

// The plans on sale, for the plans page. Public: prices are not a secret, and one source means no
// screen can quote a different number.
router.get('/plans', (req, res) => {
  const { PLANS: P, FREE_ALLOWANCE, yearlyCents: yc } = require('../lib/money');
  res.json({
    free: { name: 'Free', cents: 0, allowance: FREE_ALLOWANCE },
    plans: ['desk', 'office'].map((k) => ({ key: k, name: P[k].name, cents: P[k].cents, yearly_cents: yc(k),
      for: P[k].for, includes: P[k].includes, allowance: P[k].allowance })),
    bundles: Object.entries(require('../lib/money').BUNDLES).map(([k, x]) => ({
      key: k, name: x.name, labs: x.labs, flow: x.flow, cents: x.cents,
      yearly_cents: require('../lib/money').bundleYearlyCents(k),
      separate_cents: require('../lib/money').bundleSeparateCents(k) })),
    topups: Object.entries(require('../lib/money').TOPUPS).map(([k, t]) => ({ key: k, units: t.units, label: t.label,
      cents: require('../lib/money').TOPUP_CENTS })),
    allowances_enforced: true,
  });
});

// What this person has used this month and what is left, in numbers the plans page reads aloud.
router.get('/allowance', authenticate, asyncHandler(async (req, res) => {
  const A = require('../services/allowance');
  const s = await A.summary(req.user);
  const plan = Object.values(s)[0].plan;
  res.json({ plan, unlimited: Object.values(s)[0].unlimited, usage: s });
}));

router.post('/topup', authenticate, [
  body('kind').isIn(Object.keys(require('../lib/money').TOPUPS)),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Choose messages, builds or compliance questions.' });
  const { TOPUPS, TOPUP_CENTS } = require('../lib/money');
  const t = TOPUPS[req.body.kind];
  const base = (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/+$/, '');
  const checkout = await require('../services/stripe').createTopupCheckout({
    userId: req.user.id, email: req.user.email, kind: req.body.kind, units: t.units, label: t.label,
    priceCents: TOPUP_CENTS, successUrl: base + '/plans.html?topup=done', cancelUrl: base + '/plans.html?sub=canceled' });
  if (!checkout.ok) {
    return res.json({ ok: false, message: 'Checkout did not open, and nothing was charged. Please try again in a moment.' });
  }
  res.json({ ok: true, url: checkout.url });
}));

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT s.*, c.title AS concept_title
       FROM subscriptions s LEFT JOIN concepts c ON c.id = s.concept_id
      WHERE s.user_id=$1 ORDER BY s.created_at DESC`, [req.user.id]);
  res.json({ subscriptions: r.rows, staff_exempt: billingExempt(req.user) });
}));

// Changing your mind while you are still paid up. A $19 plan does not survive "email us to come
// back": most people simply leave instead.
router.post('/:id/resume', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    'SELECT id, stripe_subscription_id, status, cancel_at_period_end FROM subscriptions WHERE id=$1 AND user_id=$2',
    [req.params.id, req.user.id]);
  const sub = r.rows[0];
  if (!sub) throw new ApiError(404, 'No subscription of yours with that id.');
  if (!sub.cancel_at_period_end) {
    return res.json({ subscription: sub, already: true,
      note: sub.status === 'canceled'
        ? 'That plan has already ended. Starting again is a fresh checkout.'
        : 'That plan was not due to end, so nothing changed.' });
  }
  if (!sub.stripe_subscription_id) throw new ApiError(409, 'That plan has no Stripe record to resume.');
  const out = await stripe.resumeSubscription(sub.stripe_subscription_id);
  if (!out.ok) throw new ApiError(409, out.says || 'Stripe would not resume that plan, so nothing changed.');
  const updated = await query(
    'UPDATE subscriptions SET cancel_at_period_end=false, updated_at=now() WHERE id=$1 RETURNING *',
    [sub.id]);
  res.json({ subscription: updated.rows[0], resumed: true,
    note: 'It will renew as normal. Nothing was charged now.' });
}));

router.post('/:id/cancel', authenticate, asyncHandler(async (req, res) => {
  const sub = (await query(
    'SELECT id, stripe_subscription_id, status, cancel_at_period_end FROM subscriptions WHERE id=$1 AND user_id=$2',
    [req.params.id, req.user.id])).rows[0];
  if (!sub) return res.status(404).json({ error: 'Subscription not found.' });
  if (sub.status === 'canceled') return res.json({ subscription: sub, already: true });
  if (sub.cancel_at_period_end) return res.json({ subscription: sub, ends_at_period_end: true, already: true });

  // Stop the renewal in Stripe FIRST, at PERIOD END — the person keeps the access they've
  // already paid for until their current period closes. We never revoke access mid-period for a
  // plan they paid for, and never keep billing while we've revoked access. If Stripe can't
  // confirm the change, we change nothing and say so.
  let scheduled = false;
  if (sub.stripe_subscription_id) {
    const c = await stripe.cancelSubscription(sub.stripe_subscription_id, { atPeriodEnd: true });
    if (!c.ok && c.reason !== 'stripe_not_configured') {
      return res.status(502).json({ error: 'Could not stop billing with the payment processor just now, so nothing was changed. Please try again in a moment — you have not lost access.' });
    }
    scheduled = c.ok && !c.alreadyGone;
  }

  if (scheduled) {
    // Keep the row active (so entitlement continues) and flag it. Stripe's
    // customer.subscription.deleted at period end flips it to canceled.
    const r = await query(
      "UPDATE subscriptions SET cancel_at_period_end=true, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *",
      [req.params.id, req.user.id]);
    return res.json({ subscription: r.rows[0], ends_at_period_end: true });
  }

  // Nothing to keep alive (a complimentary sub with no Stripe id, an already-gone Stripe sub, or
  // Stripe not configured): end it now — there's no paid billing period left to honor.
  const r = await query(
    "UPDATE subscriptions SET status='canceled', updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *",
    [req.params.id, req.user.id]);
  res.json({ subscription: r.rows[0] });
}));

module.exports = router;
