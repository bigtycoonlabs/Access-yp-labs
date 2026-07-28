const express = require('express');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../lib/http');
const stripe = require('../services/stripe');
const router = express.Router();

// Current seller payout status.
router.get('/status', authenticate, asyncHandler(async (req, res) => {
  const r = await query('SELECT stripe_account_id, kyc_status FROM seller_accounts WHERE user_id=$1', [req.user.id]);
  const row = r.rows[0] || null;
  res.json({
    onboarded: !!(row && row.stripe_account_id),
    kyc_status: row ? row.kyc_status : 'not_started',
    stripe_configured: stripe.configured(),
  });
}));

// Begin (or resume) Stripe Connect onboarding. Returns a hosted onboarding URL.
router.post('/onboard', authenticate, asyncHandler(async (req, res) => {
  if (!stripe.configured()) {
    return res.status(200).json({ ok: false, reason: 'stripe_not_configured',
      message: 'Payouts are not configured on the platform yet. Nothing was charged or created.' });
  }
  let row = (await query('SELECT * FROM seller_accounts WHERE user_id=$1', [req.user.id])).rows[0];
  let accountId = row && row.stripe_account_id;

  if (!accountId) {
    const me = (await query('SELECT email FROM users WHERE id=$1', [req.user.id])).rows[0];
    const created = await stripe.createConnectedAccount(me.email);
    if (!created.ok) return res.status(502).json({ ok: false, message: 'Could not create a payout account.' });
    accountId = created.accountId;
    await query(
      `INSERT INTO seller_accounts (user_id, stripe_account_id, kyc_status)
       VALUES ($1,$2,'pending')
       ON CONFLICT (user_id) DO UPDATE SET stripe_account_id=EXCLUDED.stripe_account_id`,
      [req.user.id, accountId]);
  }
  const link = await stripe.createAccountLink({
    accountId,
    refreshUrl: `${process.env.CLIENT_URL}/dashboard.html?onboard=refresh`,
    returnUrl: `${process.env.CLIENT_URL}/dashboard.html?onboard=done`,
  });
  if (!link.ok) return res.status(502).json({ ok: false, message: 'Could not start onboarding.' });
  res.json({ ok: true, url: link.url });
}));

// Sync KYC/payout readiness from Stripe.
router.post('/refresh', authenticate, asyncHandler(async (req, res) => {
  const row = (await query('SELECT stripe_account_id FROM seller_accounts WHERE user_id=$1', [req.user.id])).rows[0];
  if (!row || !row.stripe_account_id) return res.status(404).json({ error: 'No payout account yet.' });
  const a = await stripe.retrieveAccount(row.stripe_account_id);
  if (!a.ok) return res.status(200).json({ kyc_status: 'pending', stripe_configured: false });
  const status = a.charges_enabled && a.details_submitted ? 'verified' : 'pending';
  await query('UPDATE seller_accounts SET kyc_status=$2 WHERE user_id=$1', [req.user.id, status]);
  res.json({ kyc_status: status, payouts_enabled: a.payouts_enabled });
}));

module.exports = router;
