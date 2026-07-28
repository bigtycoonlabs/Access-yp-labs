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

// Time out abandoned concepts: past their access window, with no active plan
// covering them and not currently listed. Cascades to assets/generations.
router.post('/expire-concepts', guard, asyncHandler(async (req, res) => {
  const r = await query(
    `DELETE FROM concepts c
     WHERE c.access_expires_at < now()
       AND NOT EXISTS (
         SELECT 1 FROM subscriptions s WHERE s.status='active'
           AND ((s.plan='sculptor' AND s.user_id=c.owner_id)
             OR (s.plan='maker' AND s.concept_id=c.id)))
       AND NOT EXISTS (
         SELECT 1 FROM listings l WHERE l.concept_id=c.id AND l.status IN ('live','in_review'))
     RETURNING id`);
  res.json({ removed: r.rows.length });
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
