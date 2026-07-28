const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../lib/http');
const router = express.Router();

// Any member can report content for staff review.
router.post('/', authenticate, [
  body('target_type').isIn(['listing', 'concept', 'user', 'review']),
  body('target_id').isUUID(),
  body('reason').isString().trim().notEmpty(),
  body('details').optional().isString(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { target_type, target_id, reason, details } = req.body;
  const r = await query(
    `INSERT INTO reports (reporter_id, target_type, target_id, reason, details)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [req.user.id, target_type, target_id, reason, details || null]);
  res.status(201).json({ ok: true, id: r.rows[0].id, message: 'Thank you — our staff will review this.' });
}));

module.exports = router;
