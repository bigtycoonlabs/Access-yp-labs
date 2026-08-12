const express = require('express');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../lib/http');
const stripe = require('../services/stripe');
const router = express.Router();

// Current seller payout status.
router.get('/status', authenticate, asyncHandler(async (req, res) => {
  const r = await query('SELECT stripe_account_id, kyc_status FROM seller_accounts WHERE user_id=$1', [req.user.id]);
  const u = await query('SELECT display_name FROM users WHERE id=$1', [req.user.id]);
  const row = r.rows[0] || null;
  res.json({
    onboarded: !!(row && row.stripe_account_id),
    kyc_status: row ? row.kyc_status : 'not_started',
    stripe_configured: stripe.configured(),
    display_name: (u.rows[0] && u.rows[0].display_name) || null,
  });
}));

// Public pen name for Exchange listings — separate from, and shown instead of,
// the real account name. Anonymity is public-only; we still know the real user.
router.put('/alias', authenticate, asyncHandler(async (req, res) => {
  const name = (req.body && typeof req.body.display_name === 'string') ? req.body.display_name.trim() : '';
  if (name.length < 2 || name.length > 40) {
    return res.status(400).json({ error: 'Your pen name needs to be between 2 and 40 characters.' });
  }
  await query('UPDATE users SET display_name=$1 WHERE id=$2', [name, req.user.id]);
  res.json({ display_name: name });
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
    if (!created.ok) {
      return res.status(502).json({ ok: false,
        error: 'Stripe could not create your payout account.' + (created.message ? ' It said: ' + created.message : ''),
        detail: created.detail || null });
    }
    accountId = created.accountId;
    await query(
      `INSERT INTO seller_accounts (user_id, stripe_account_id, kyc_status)
       VALUES ($1,$2,'pending')
       ON CONFLICT (user_id) DO UPDATE SET stripe_account_id=EXCLUDED.stripe_account_id`,
      [req.user.id, accountId]);
  }
  const base = (process.env.CLIENT_URL || '').startsWith('https') ? process.env.CLIENT_URL : 'https://accessyplabs.com';
  const link = await stripe.createAccountLink({
    accountId,
    refreshUrl: `${base}/dashboard.html?onboard=refresh`,
    returnUrl: `${base}/dashboard.html?onboard=done`,
  });
  if (!link.ok) {
    return res.status(502).json({ ok: false,
      error: 'Stripe could not start your onboarding.' + (link.message ? ' It said: ' + link.message : ''),
      detail: link.detail || null });
  }
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
