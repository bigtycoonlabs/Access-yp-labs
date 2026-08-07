const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const { CONSULT_FEE_CENTS, CONSULT_PLATFORM_CENTS, CONSULT_CONSULTANT_CENTS, CONSULT_WINDOW_HOURS } = require('../lib/money');
const stripe = require('../services/stripe');
const router = express.Router();

// Apply to become a consultant (application-gated; staff auto-enroll separately).
router.post('/apply', authenticate, [
  body('entrepreneur_history').isString().notEmpty(),
  body('marketplace_track').isString(),
  body('concepts_to_market').isString(),
  body('prior_businesses').isString(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { entrepreneur_history, marketplace_track, concepts_to_market, prior_businesses } = req.body;
  const r = await query(
    `INSERT INTO consultant_applications
       (user_id, entrepreneur_history, marketplace_track, concepts_to_market, prior_businesses)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.id, entrepreneur_history, marketplace_track, concepts_to_market, prior_businesses]);
  res.status(201).json({ application: r.rows[0] });
}));

// Admin approves an application -> creates/enables a consultant.
router.post('/applications/:id/approve', authenticate, authorize('admin', 'master_staff'),
  asyncHandler(async (req, res) => {
    const a = await query(`UPDATE consultant_applications SET status='approved' WHERE id=$1 RETURNING *`, [req.params.id]);
    if (!a.rows.length) throw new ApiError(404, 'Application not found.');
    await query(
      `INSERT INTO consultants (user_id, approved, badge, rate_display)
       VALUES ($1,true,true,'$150 / 90-min session')
       ON CONFLICT (user_id) DO UPDATE SET approved=true, badge=true`, [a.rows[0].user_id]);
    await query(`UPDATE users SET role='consultant' WHERE id=$1 AND role='member'`, [a.rows[0].user_id]);
    res.json({ approved: true, user_id: a.rows[0].user_id });
  }));

// Admin: list submitted applications for review.
router.get('/applications', authenticate, authorize('admin', 'master_staff'),
  asyncHandler(async (req, res) => {
    const r = await query(
      `SELECT a.*, u.name, u.email FROM consultant_applications a
       JOIN users u ON u.id=a.user_id WHERE a.status='submitted' ORDER BY a.created_at ASC`);
    res.json({ applications: r.rows });
  }));

// Staff enroll themselves as a consultant — no application, no approval wait.
// Staff are never billed and can post as consultants directly. Idempotent.
router.post('/enroll', authenticate, authorize('staff', 'admin', 'master_staff'),
  asyncHandler(async (req, res) => {
    await query(
      `INSERT INTO consultants (user_id, approved, badge, rate_display)
       VALUES ($1,true,true,'$150 / 90-min session')
       ON CONFLICT (user_id) DO UPDATE SET approved=true, badge=true`, [req.user.id]);
    res.status(201).json({ enrolled: true });
  }));

// Whether the signed-in user is already posting as a consultant.
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const r = await query('SELECT approved FROM consultants WHERE user_id=$1', [req.user.id]);
  res.json({ consultant: r.rows.length ? { approved: r.rows[0].approved } : null });
}));

// Public directory of approved consultants.
router.get('/', asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT c.user_id, u.name, c.rate_display, c.successful_launches, c.badge
     FROM consultants c JOIN users u ON u.id=c.user_id WHERE c.approved=true
     ORDER BY c.successful_launches DESC`);
  res.json({ consultants: r.rows });
}));

// Client requests an engagement about one of their concepts.
router.post('/engagements', authenticate, [
  body('consultant_id').isUUID(),
  body('concept_id').optional().isUUID(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { consultant_id, concept_id } = req.body;
  const c = await query('SELECT approved FROM consultants WHERE user_id=$1', [consultant_id]);
  if (!c.rows.length || !c.rows[0].approved) throw new ApiError(404, 'Consultant not available.');
  // If the client names a concept, it must be their own — never let an engagement point at
  // someone else's concept, so a future "share concept with consultant" step can't leak it.
  if (concept_id) {
    const own = await query('SELECT id FROM concepts WHERE id=$1 AND owner_id=$2', [concept_id, req.user.id]);
    if (!own.rows.length) throw new ApiError(404, 'That project could not be found — it may have been removed, or it may not be yours.');
  }
  const r = await query(
    `INSERT INTO consultant_engagements (client_id, consultant_id, concept_id, state)
     VALUES ($1,$2,$3,'requested') RETURNING *`,
    [req.user.id, consultant_id, concept_id || null]);
  res.status(201).json({ engagement: r.rows[0] });
}));

async function loadEngagement(id, userId, role) {
  const r = await query('SELECT * FROM consultant_engagements WHERE id=$1', [id]);
  if (!r.rows.length) throw new ApiError(404, 'Engagement not found.');
  const e = r.rows[0];
  const party = role === 'consultant' ? e.consultant_id : e.client_id;
  if (party !== userId) throw new ApiError(403, 'Not your engagement.');
  return e;
}

// Consultant accepts.
router.post('/engagements/:id/accept', authenticate, asyncHandler(async (req, res) => {
  await loadEngagement(req.params.id, req.user.id, 'consultant');
  const r = await query(
    `UPDATE consultant_engagements SET state='accepted' WHERE id=$1 AND state='requested' RETURNING *`,
    [req.params.id]);
  if (!r.rows.length) throw new ApiError(400, 'Engagement is not awaiting acceptance.');
  res.json({ engagement: r.rows[0] });
}));

// HARD GATE: consultant signs the NDA before the concept is ever shared.
router.post('/engagements/:id/nda', authenticate, asyncHandler(async (req, res) => {
  await loadEngagement(req.params.id, req.user.id, 'consultant');
  const r = await query(
    `UPDATE consultant_engagements SET state='nda_signed', nda_signed_at=NOW()
     WHERE id=$1 AND state='accepted' RETURNING *`, [req.params.id]);
  if (!r.rows.length) throw new ApiError(400, 'Engagement must be accepted before signing the NDA.');
  res.json({ engagement: r.rows[0], note: 'NDA signed. The concept can now be shared with the consultant.' });
}));

// Client pays $150 — a real Stripe charge. The consultant's $120 is routed to their own
// connected account and the platform keeps $30, exactly like a marketplace sale. The
// engagement flips to 'paid' only when the verified webhook confirms the money landed — never
// on optimism — and the concept unlocks then. We refuse to collect if the consultant has no
// payout-ready account, so we never take money we can't pay out.
router.post('/engagements/:id/pay', authenticate, asyncHandler(async (req, res) => {
  const e = await loadEngagement(req.params.id, req.user.id, 'client');
  if (!e.nda_signed_at) throw new ApiError(400, 'Consultant must sign the NDA before payment unlocks the concept.');
  if (e.state !== 'nda_signed') throw new ApiError(400, 'Engagement is not ready for payment.');

  if (!stripe.configured()) {
    return res.json({ ok: false, reason: 'stripe_not_configured',
      message: 'Payments aren’t configured on the platform yet, so nothing was charged.' });
  }
  // The consultant must have a payout-ready connected account, or there's nowhere to send their
  // $120 — never take a client's money we can't pay out.
  const pa = (await query('SELECT stripe_account_id, kyc_status FROM seller_accounts WHERE user_id=$1', [e.consultant_id])).rows[0];
  if (!pa || !pa.stripe_account_id || pa.kyc_status !== 'verified') {
    return res.json({ ok: false, reason: 'consultant_not_payable',
      message: 'This consultant hasn’t finished setting up payouts yet, so payment can’t be collected. They need to complete payout onboarding first.' });
  }

  const me = (await query('SELECT email FROM users WHERE id=$1', [req.user.id])).rows[0];
  const base = (process.env.CLIENT_URL || '').startsWith('https') ? process.env.CLIENT_URL : 'https://accessyplabs.com';
  const checkout = await stripe.createConsultCheckout({
    amountCents: CONSULT_FEE_CENTS, feeCents: CONSULT_PLATFORM_CENTS,
    consultantAccountId: pa.stripe_account_id, engagementId: e.id, email: me && me.email,
    successUrl: `${base}/dashboard.html?consult=paid`,
    cancelUrl: `${base}/dashboard.html?consult=canceled`,
  });
  if (!checkout.ok) {
    return res.status(502).json({ ok: false, message: checkout.message || 'Could not start checkout. Nothing was charged.' });
  }
  await query('UPDATE consultant_engagements SET payment_ref=$2 WHERE id=$1', [e.id, checkout.sessionId]);
  res.json({ ok: true, checkout_url: checkout.url });
}));

// Consultant delivers the session: opens the 12-hour continuation window. The consultant's
// $120 was already routed to their connected account when the client paid (a Stripe
// destination charge), so delivery is about the client's free-continuation window, not payment.
router.post('/engagements/:id/deliver', authenticate, asyncHandler(async (req, res) => {
  await loadEngagement(req.params.id, req.user.id, 'consultant');
  const r = await query(
    `UPDATE consultant_engagements
       SET state='session_delivered', session_delivered_at=NOW(),
           window_expires_at = NOW() + ($2 || ' hours')::interval
     WHERE id=$1 AND state='paid' RETURNING *`,
    [req.params.id, String(CONSULT_WINDOW_HOURS)]);
  if (!r.rows.length) throw new ApiError(400, 'Engagement must be paid before a session is delivered.');
  res.json({ engagement: r.rows[0],
    note: 'Session delivered. This completes the initial consultation the platform arranges. There\u2019s a 12-hour window to keep going free — and from here, if you both want to keep working together, you arrange it directly, including how the consultant is paid, however you like.' });
}));

// Client continues free with the same consultant within the 12-hour window.
router.post('/engagements/:id/continue', authenticate, asyncHandler(async (req, res) => {
  const e = await loadEngagement(req.params.id, req.user.id, 'client');
  if (e.state !== 'session_delivered') throw new ApiError(400, 'No delivered session to continue.');
  if (!e.window_expires_at || new Date(e.window_expires_at) < new Date()) {
    throw new ApiError(400, 'The free continuation window has closed. From here, you and the consultant arrange any ongoing work and how they\u2019re paid directly, however you like \u2014 or book a fresh initial session through the platform if you\u2019d rather.');
  }
  const r = await query(`UPDATE consultant_engagements SET state='continued' WHERE id=$1 RETURNING *`, [req.params.id]);
  res.json({ engagement: r.rows[0] });
}));

// Client confirms a launch resulted — builds the consultant's portfolio. One-time, and only
// after a session was actually delivered: the launch count ranks the public directory, so it
// must not be pumpable by calling this repeatedly or on an engagement where nothing happened.
router.post('/engagements/:id/confirm-launch', authenticate, asyncHandler(async (req, res) => {
  const e = await loadEngagement(req.params.id, req.user.id, 'client');
  const r = await query(
    `UPDATE consultant_engagements SET launch_confirmed=true
     WHERE id=$1 AND launch_confirmed=false AND state IN ('session_delivered','continued')
     RETURNING *`, [req.params.id]);
  if (!r.rows.length) {
    throw new ApiError(400, 'A launch can only be confirmed once, and only after a session has been delivered.');
  }
  await query('UPDATE consultants SET successful_launches=successful_launches+1 WHERE user_id=$1', [e.consultant_id]);
  res.json({ engagement: r.rows[0] });
}));

router.get('/engagements', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT * FROM consultant_engagements WHERE client_id=$1 OR consultant_id=$1 ORDER BY created_at DESC`,
    [req.user.id]);
  res.json({ engagements: r.rows });
}));

module.exports = router;
