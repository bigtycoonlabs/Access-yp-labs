const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../lib/http');
const router = express.Router();

// Own profile
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const r = await query('SELECT * FROM profiles WHERE user_id=$1', [req.user.id]);
  res.json({ profile: r.rows[0] || null });
}));

// Update own profile (About Me + per-section visibility). Contact info is never a field.
router.put('/me', authenticate, [
  body('about_me').optional().isString(),
  body('show_concepts').optional().isBoolean(),
  body('show_completed').optional().isBoolean(),
  body('show_listings').optional().isBoolean(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { about_me, show_concepts, show_completed, show_listings } = req.body;
  const r = await query(
    `INSERT INTO profiles (user_id, about_me, show_concepts, show_completed, show_listings, updated_at)
     VALUES ($1, COALESCE($2,''), COALESCE($3,false), COALESCE($4,true), COALESCE($5,true), NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       about_me      = COALESCE($2, profiles.about_me),
       show_concepts = COALESCE($3, profiles.show_concepts),
       show_completed= COALESCE($4, profiles.show_completed),
       show_listings = COALESCE($5, profiles.show_listings),
       updated_at    = NOW()
     RETURNING *`,
    [req.user.id, about_me, show_concepts, show_completed, show_listings]
  );
  res.json({ profile: r.rows[0] });
}));

// Public profile — respects visibility flags, never returns email/phone/contact.
router.get('/:userId', asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT u.id, u.name, p.about_me, p.show_concepts, p.show_completed, p.show_listings
     FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id=$1`, [req.params.userId]);
  if (!r.rows.length) return res.status(404).json({ error: 'Profile not found.' });
  const p = r.rows[0];
  const out = { id: p.id, name: p.name, about_me: p.about_me };
  if (p.show_listings) {
    const l = await query(
      `SELECT id, concept_id, price_cents, format, stage_label, status
       FROM listings WHERE seller_id=$1 AND status='live'`, [p.id]);
    out.listings = l.rows;
  }
  res.json({ profile: out });
}));

module.exports = router;
