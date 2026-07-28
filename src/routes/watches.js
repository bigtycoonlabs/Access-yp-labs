const express = require('express');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../lib/http');
const router = express.Router();

router.post('/:listingId', authenticate, asyncHandler(async (req, res) => {
  await query(
    `INSERT INTO watches (user_id, listing_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [req.user.id, req.params.listingId]);
  res.status(201).json({ ok: true });
}));

router.delete('/:listingId', authenticate, asyncHandler(async (req, res) => {
  await query('DELETE FROM watches WHERE user_id=$1 AND listing_id=$2', [req.user.id, req.params.listingId]);
  res.json({ ok: true });
}));

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT l.id, l.price_cents, l.format, l.stage_label, l.status, c.title, c.category
     FROM watches w JOIN listings l ON l.id=w.listing_id JOIN concepts c ON c.id=l.concept_id
     WHERE w.user_id=$1 ORDER BY w.created_at DESC`, [req.user.id]);
  res.json({ watches: r.rows });
}));

module.exports = router;
