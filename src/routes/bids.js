const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const { isAboveFloor } = require('../lib/money');
const router = express.Router();

// Place a bid on a live auction listing. Must beat the current high bid and the floor.
router.post('/:listingId', authenticate, [
  body('amount_cents').isInt({ min: 5000 }),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { amount_cents } = req.body;

  const l = await query('SELECT * FROM listings WHERE id=$1', [req.params.listingId]);
  if (!l.rows.length || l.rows[0].status !== 'live') throw new ApiError(404, 'Live listing not found.');
  const listing = l.rows[0];
  if (listing.format !== 'auction') throw new ApiError(400, 'This listing is not an auction.');
  if (listing.seller_id === req.user.id) throw new ApiError(400, 'You cannot bid on your own listing.');
  if (listing.auction_close_at && new Date(listing.auction_close_at) < new Date()) {
    throw new ApiError(400, 'This auction has closed.');
  }
  if (!isAboveFloor(amount_cents)) throw new ApiError(400, 'Bid must be at least $50.');

  const high = await query('SELECT COALESCE(MAX(amount_cents),0) AS m FROM bids WHERE listing_id=$1', [req.params.listingId]);
  const floor = Math.max(listing.starting_bid_cents || 0, high.rows[0].m);
  if (amount_cents <= floor) throw new ApiError(400, `Bid must exceed the current high of $${(floor / 100).toFixed(2)}.`);

  const r = await query(
    `INSERT INTO bids (listing_id, bidder_id, amount_cents) VALUES ($1,$2,$3) RETURNING *`,
    [req.params.listingId, req.user.id, amount_cents]);
  res.status(201).json({ bid: r.rows[0] });
}));

router.get('/:listingId', asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT id, amount_cents, created_at FROM bids WHERE listing_id=$1 ORDER BY amount_cents DESC`,
    [req.params.listingId]);
  res.json({ bids: r.rows });
}));

module.exports = router;
