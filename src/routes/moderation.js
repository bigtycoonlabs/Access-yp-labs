const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const router = express.Router();

// Only policy-ground reasons exist. "Competes with mine" is deliberately not a
// selectable reason anywhere in the system.
const REASONS = ['missing_baseline', 'running_business', 'fraud', 'missing_risk_disclosure'];

// Review queue.
router.get('/queue', authenticate, authorize('staff', 'admin', 'master_staff'),
  asyncHandler(async (req, res) => {
    const r = await query(
      `SELECT l.id, l.stage_label, l.price_cents, l.created_at,
              c.title, c.category, c.risk_summary, l.seller_id, u.name AS seller_name
       FROM listings l JOIN concepts c ON c.id=l.concept_id JOIN users u ON u.id=l.seller_id
       WHERE l.status='in_review' ORDER BY l.created_at ASC`);
    res.json({ queue: r.rows });
  }));

// Decide on a listing. Neutrality is enforced: a moderator who is the seller
// must recuse and cannot decide. Every decision is written to the audit log.
router.post('/:listingId/decide', authenticate, authorize('staff', 'admin', 'master_staff'), [
  body('decision').isIn(['approved', 'rejected']),
  body('reason').optional().isIn(REASONS),
  body('notes').optional().isString(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { decision, reason, notes } = req.body;

  const l = await query('SELECT * FROM listings WHERE id=$1', [req.params.listingId]);
  if (!l.rows.length) throw new ApiError(404, 'Listing not found.');
  const listing = l.rows[0];

  // Auto-recusal — a moderator cannot rule on their own listing.
  if (listing.seller_id === req.user.id) {
    await query(
      `INSERT INTO moderation_actions (listing_id, moderator_id, decision, recused, notes)
       VALUES ($1,$2,$3,true,'auto-recused: moderator is the seller')`,
      [listing.id, req.user.id, decision]);
    throw new ApiError(403, 'You must recuse yourself — you are the seller of this listing.');
  }
  if (decision === 'rejected' && !reason) {
    throw new ApiError(400, 'A policy reason code is required to reject a listing.');
  }
  if (listing.status !== 'in_review') throw new ApiError(400, 'Listing is not in review.');

  const newStatus = decision === 'approved' ? 'live' : 'rejected';
  await query('UPDATE listings SET status=$2, updated_at=NOW() WHERE id=$1', [listing.id, newStatus]);
  const act = await query(
    `INSERT INTO moderation_actions (listing_id, moderator_id, decision, reason, notes)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [listing.id, req.user.id, decision, reason || null, notes || null]);
  res.json({ listing_status: newStatus, action: act.rows[0] });
}));

// Full audit trail for a listing.
router.get('/log/:listingId', authenticate, authorize('staff', 'admin', 'master_staff'),
  asyncHandler(async (req, res) => {
    const r = await query(
      `SELECT m.*, u.name AS moderator_name FROM moderation_actions m
       JOIN users u ON u.id=m.moderator_id WHERE m.listing_id=$1 ORDER BY m.created_at`,
      [req.params.listingId]);
    res.json({ log: r.rows });
  }));

module.exports = router;
