const express = require('express');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../lib/http');
const router = express.Router();

// Guard: allow a scheduler via MAINTENANCE_KEY header, or an admin session.
function guard(req, res, next) {
  const key = req.headers['x-maintenance-key'];
  if (key && process.env.MAINTENANCE_KEY && key === process.env.MAINTENANCE_KEY) return next();
  return authenticate(req, res, () => {
    if (['admin', 'master_staff'].includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Not authorized.' });
  });
}

// Time out abandoned PURCHASED concepts: past their paid access window, with no active plan
// covering them and not currently listed. This is now a SOFT expiry — we set expired_at and
// hide the concept, but never hard-delete it. The owner's paid access has already ended, so
// hiding matches their real access state, and the work stays recoverable if they come back and
// resubscribe. Consistent with the free-concept expiry: a dream is never destroyed outright.
router.post('/expire-concepts', guard, asyncHandler(async (req, res) => {
  const r = await query(
    `UPDATE concepts c SET expired_at=now()
     WHERE c.expired_at IS NULL
       AND c.access_expires_at < now()
       AND NOT EXISTS (
         SELECT 1 FROM subscriptions s WHERE s.status='active'
           AND ((s.plan='sculptor' AND s.user_id=c.owner_id)
             OR (s.plan='maker' AND s.concept_id=c.id)))
       AND NOT EXISTS (
         SELECT 1 FROM listings l WHERE l.concept_id=c.id AND l.status IN ('live','in_review'))
     RETURNING id`);
  res.json({ soft_expired: r.rows.length });
}));

// Concepts expiring within 7 days (owner-facing reminder feed).
router.get('/expiring-soon', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT id, title, access_expires_at FROM concepts
     WHERE owner_id=$1 AND access_expires_at < now() + interval '7 days'
       AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.status='active'
         AND ((s.plan='sculptor' AND s.user_id=$1) OR (s.plan='maker' AND s.concept_id=concepts.id)))
     ORDER BY access_expires_at ASC`, [req.user.id]);
  res.json({ expiring: r.rows });
}));

module.exports = router;
