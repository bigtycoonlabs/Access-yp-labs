const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../lib/http');
const { PLANS, planCents } = require('../lib/money');
const { isStaff } = require('../lib/entitlement');
const stripe = require('../services/stripe');
const router = express.Router();

// Begin checkout for a plan. Maker is per-concept; Sculptor is unlimited.
// A subscription becomes active only via the verified webhook after real
// payment — never created unpaid here. Staff never pay.
router.post('/', authenticate, [
  body('plan').isIn(['maker', 'sculptor']),
  body('concept_id').optional().isUUID(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  if (isStaff(req.user.role)) {
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

  const checkout = await stripe.createPlanCheckout({
    mode: 'subscription', priceCents: planCents(plan), planName: PLANS[plan].label, plan,
    conceptId, userId: req.user.id, email: req.user.email,
    successUrl: `${process.env.CLIENT_URL}/dashboard.html?sub=done`,
    cancelUrl: `${process.env.CLIENT_URL}/dashboard.html?sub=canceled`,
  });
  if (!checkout.ok) {
    return res.status(200).json({ ok: false, reason: checkout.reason,
      message: 'Billing is not configured on the platform yet, so nothing was charged.' });
  }
  res.json({ ok: true, url: checkout.url });
}));

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const r = await query('SELECT * FROM subscriptions WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ subscriptions: r.rows, staff_exempt: isStaff(req.user.role) });
}));

router.post('/:id/cancel', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `UPDATE subscriptions SET status='canceled', updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *`,
    [req.params.id, req.user.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Subscription not found.' });
  res.json({ subscription: r.rows[0] });
}));

module.exports = router;
