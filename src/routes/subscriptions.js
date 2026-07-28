const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../lib/http');
const { SUB_PER_IDEA_CENTS, SUB_UNLIMITED_CENTS } = require('../lib/money');
const stripe = require('../services/stripe');
const router = express.Router();

// Begin checkout for a plan. A subscription becomes active only via the
// verified webhook after real payment — never created unpaid here.
router.post('/', authenticate, [
  body('plan').isIn(['per_idea', 'unlimited']),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { plan } = req.body;
  const priceCents = plan === 'unlimited' ? SUB_UNLIMITED_CENTS : SUB_PER_IDEA_CENTS;
  const mode = plan === 'unlimited' ? 'subscription' : 'payment';
  const planName = plan === 'unlimited' ? 'The Kiln — Unlimited ideas (monthly)' : 'The Kiln — One idea';

  const checkout = await stripe.createPlanCheckout({
    mode, priceCents, planName, plan,
    userId: req.user.id, email: req.user.email,
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
  res.json({ subscriptions: r.rows });
}));

router.post('/:id/cancel', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `UPDATE subscriptions SET status='canceled' WHERE id=$1 AND user_id=$2 RETURNING *`,
    [req.params.id, req.user.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Subscription not found.' });
  res.json({ subscription: r.rows[0] });
}));

module.exports = router;
