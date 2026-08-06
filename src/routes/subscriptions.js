const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../lib/http');
const { PLANS, planCents } = require('../lib/money');
const { isStaff, billingExempt } = require('../lib/entitlement');
const stripe = require('../services/stripe');
const router = express.Router();

// Begin checkout for a plan. Maker is per-concept; Sculptor is unlimited.
// A subscription becomes active only via the verified webhook after real
// payment — never created unpaid here. Staff never pay.
router.post('/', authenticate, [
  body('plan').isIn(['builder']),
  body('concept_id').optional().isUUID(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  if (billingExempt(req.user)) {
    return res.json({ ok: false, reason: 'staff_exempt', message: 'Staff accounts have full access and are never charged.' });
  }
  const { plan } = req.body;
  let conceptId = req.body.concept_id || null;

  if (plan === 'maker') {
    if (!conceptId) return res.status(400).json({ error: 'Maker is a per-concept plan — a concept is required.' });
    const own = await query('SELECT id FROM concepts WHERE id=$1 AND owner_id=$2', [conceptId, req.user.id]);
    if (!own.rows.length) return res.status(404).json({ error: 'Concept not found.' });
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
    mode: 'subscription', priceCents: planCents(plan), planName: PLANS[plan].label, plan,
    conceptId, userId: req.user.id, email: req.user.email,
    successUrl: `${base}/dashboard.html?sub=done`,
    cancelUrl: `${base}/dashboard.html?sub=canceled`,
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

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT s.*, c.title AS concept_title
       FROM subscriptions s LEFT JOIN concepts c ON c.id = s.concept_id
      WHERE s.user_id=$1 ORDER BY s.created_at DESC`, [req.user.id]);
  res.json({ subscriptions: r.rows, staff_exempt: billingExempt(req.user) });
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
