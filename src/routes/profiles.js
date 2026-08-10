const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const router = express.Router();

// Own profile
// PUT /api/profiles/me/details — the things a person actually manages about themselves.
//
// The profile page used to offer About Me and three checkboxes and nothing else, so somebody could
// not change their own name, their email, their phone, or the public tag that appears on every
// listing they make. The tag was changeable only by asking Clay in conversation, which is a fine way
// to do it and a poor way to be the ONLY way to do it.
router.put('/me/details', authenticate, [
  body('display_name').optional().isString().trim().isLength({ min: 2, max: 40 }),
  body('name').optional().isString().trim().isLength({ min: 1, max: 80 }),
  body('email').optional().isEmail().normalizeEmail(),
  body('phone').optional().isString().trim().isLength({ min: 7, max: 30 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ApiError(400, 'A public name needs 2 to 40 characters, and an email has to be a real address.');
  }
  const changed = [];
  const cur = await query('SELECT display_name, name, email, phone FROM users WHERE id=$1', [req.user.id]);
  const row = cur.rows[0] || {};

  if (req.body.email !== undefined && req.body.email !== row.email) {
    // Somebody else's account must not be reachable by claiming their address.
    const taken = await query('SELECT 1 FROM users WHERE email=$1 AND id<>$2', [req.body.email, req.user.id]);
    if (taken.rows.length) throw new ApiError(409, 'Another account already uses that email address.');
    await query('UPDATE users SET email=$2, updated_at=now() WHERE id=$1', [req.user.id, req.body.email]);
    changed.push('email');
  }
  for (const [field, label] of [['display_name', 'public name'], ['name', 'name'], ['phone', 'phone']]) {
    if (req.body[field] !== undefined && req.body[field] !== row[field]) {
      await query(`UPDATE users SET ${field}=$2, updated_at=now() WHERE id=$1`, [req.user.id, req.body[field]]);
      changed.push(label);
    }
  }
  if (!changed.length) {
    return res.json({ ok: true, changed: false,
      message: 'Nothing was different from what is already saved, so nothing changed.' });
  }
  res.json({ ok: true, changed: true, fields: changed,
    message: 'Saved: ' + changed.join(', ') + '.' });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT u.display_name, u.name, u.email, u.phone, p.about_me
       FROM users u LEFT JOIN profiles p ON p.user_id = u.id
      WHERE u.id = $1`, [req.user.id]);
  const row = r.rows[0] || {};
  res.json({ profile: {
    display_name: row.display_name || null, name: row.name || null,
    email: row.email || null, phone: row.phone || null, about_me: row.about_me || null,
  } });
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

// Public profile — respects visibility flags, shows the creator's pen name (never
// their real account name), and never returns email/phone/contact.
router.get('/:userId', asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT u.id, COALESCE(u.display_name, 'A Dream Market creator') AS name,
            p.about_me, p.show_concepts, p.show_completed, p.show_listings
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
