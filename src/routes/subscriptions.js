const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../lib/http');
const { SUB_PER_IDEA_CENTS, SUB_UNLIMITED_CENTS } = require('../lib/money');
const router = express.Router();

// Create a subscription: $2.99/idea (per_idea) or $49.99/mo unlimited.
router.post('/', authenticate, [
  body('plan').isIn(['per_idea', 'unlimited']),
  body('concept_id').optional().isUUID(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { plan, concept_id } = req.body;
  const price = plan === 'unlimited' ? SUB_UNLIMITED_CENTS : SUB_PER_IDEA_CENTS;
  const r = await query(
    `INSERT INTO subscriptions (user_id, plan, concept_id, price_cents)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.user.id, plan, concept_id || null, price]);
  res.status(201).json({ subscription: r.rows[0] });
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
