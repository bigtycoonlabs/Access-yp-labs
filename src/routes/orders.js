const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, getClient } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const { platformFeeCents } = require('../lib/money');
const stripe = require('../services/stripe');
const router = express.Router();

// Create an order for a live listing. All three acknowledgments are mandatory:
// the transfer agreement, the risk acknowledgment, and the no-refund policy.
router.post('/', authenticate, [
  body('listing_id').isUUID(),
  body('agreement_accepted').isBoolean(),
  body('risk_ack').isBoolean(),
  body('no_refund_ack').isBoolean(),
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { listing_id, agreement_accepted, risk_ack, no_refund_ack } = req.body;

  if (!agreement_accepted || !risk_ack || !no_refund_ack) {
    throw new ApiError(400, 'You must accept the transfer agreement, acknowledge the risk, and accept the no-refund policy.');
  }
  const l = await query('SELECT * FROM listings WHERE id=$1', [listing_id]);
  if (!l.rows.length || l.rows[0].status !== 'live') throw new ApiError(404, 'Live listing not found.');
  const listing = l.rows[0];
  if (listing.seller_id === req.user.id) throw new ApiError(400, 'You cannot buy your own listing.');

  // Settle price: flat = price; auction = highest bid, restricted to the winner.
  let amount = listing.price_cents;
  if (listing.format === 'auction') {
    if (listing.auction_close_at && new Date(listing.auction_close_at) > new Date()) {
      throw new ApiError(400, 'This auction is still open. It must close before the winner can complete the purchase.');
    }
    const h = await query(
      `SELECT bidder_id, amount_cents FROM bids WHERE listing_id=$1
       ORDER BY amount_cents DESC, created_at ASC LIMIT 1`, [listing_id]);
    if (!h.rows.length) throw new ApiError(400, 'Auction has no bids to settle.');
    if (h.rows[0].bidder_id !== req.user.id) {
      throw new ApiError(403, 'Only the winning bidder can complete this auction purchase.');
    }
    amount = h.rows[0].amount_cents;
  }
  const fee = platformFeeCents(amount);

  const r = await query(
    `INSERT INTO orders_transfers
       (listing_id, buyer_id, seller_id, amount_cents, platform_fee_cents,
        status, agreement_accepted, risk_ack, no_refund_ack)
     VALUES ($1,$2,$3,$4,$5,'created',true,true,true) RETURNING *`,
    [listing_id, req.user.id, listing.seller_id, amount, fee]);
  const order = r.rows[0];

  // Attempt escrow checkout if a verified seller Connect account exists.
  const sa = await query('SELECT stripe_account_id FROM seller_accounts WHERE user_id=$1', [listing.seller_id]);
  let checkout = { ok: false, reason: 'seller_not_onboarded' };
  if (sa.rows[0] && sa.rows[0].stripe_account_id) {
    checkout = await stripe.createEscrowCheckout({
      amountCents: amount, feeCents: fee, sellerAccountId: sa.rows[0].stripe_account_id,
      orderId: order.id,
      successUrl: `${process.env.CLIENT_URL}/orders/${order.id}?paid=1`,
      cancelUrl: `${process.env.CLIENT_URL}/orders/${order.id}?canceled=1`,
    });
  }
  res.status(201).json({ order, checkout });
}));

// Seller submits proof of shipment for physical-goods concepts.
router.post('/:id/proof', authenticate, [body('proof_of_shipment').isString().notEmpty()],
  asyncHandler(async (req, res) => {
    const r = await query(
      `UPDATE orders_transfers SET status='proof_submitted', proof_of_shipment=$3
       WHERE id=$1 AND seller_id=$2 AND status IN ('in_escrow','created') RETURNING *`,
      [req.params.id, req.user.id, req.body.proof_of_shipment]);
    if (!r.rows.length) throw new ApiError(404, 'Order not found.');
    res.json({ order: r.rows[0] });
  }));

// Seller marks the transfer delivered.
router.post('/:id/deliver', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `UPDATE orders_transfers SET status='delivered', delivered_at=NOW()
     WHERE id=$1 AND seller_id=$2 AND status IN ('in_escrow','proof_submitted','created') RETURNING *`,
    [req.params.id, req.user.id]);
  if (!r.rows.length) throw new ApiError(404, 'Order not found.');
  res.json({ order: r.rows[0] });
}));

// Buyer releases escrow. This is the clean transfer: ownership of the concept
// moves to the buyer, its assets lock as exclusive, and the listing marks sold.
router.post('/:id/release', authenticate, asyncHandler(async (req, res) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const o = await client.query(
      `SELECT * FROM orders_transfers WHERE id=$1 AND buyer_id=$2 FOR UPDATE`,
      [req.params.id, req.user.id]);
    if (!o.rows.length) throw new ApiError(404, 'Order not found.');
    const order = o.rows[0];
    if (!['delivered', 'proof_submitted', 'in_escrow'].includes(order.status)) {
      throw new ApiError(400, `Order cannot be released from status "${order.status}".`);
    }
    const l = await client.query('SELECT concept_id FROM listings WHERE id=$1', [order.listing_id]);
    const conceptId = l.rows[0].concept_id;

    // Clean transfer: buyer owns it, with the first month included; assets lock
    // as exclusive (they can't be resold without new work); listing marks sold.
    await client.query(
      `UPDATE concepts SET owner_id=$2, origin='purchased',
         access_expires_at = now() + interval '30 days', updated_at=NOW() WHERE id=$1`,
      [conceptId, order.buyer_id]);
    await client.query('UPDATE assets SET exclusive_locked=true, locked_at=now() WHERE concept_id=$1', [conceptId]);
    await client.query(`UPDATE listings SET status='sold', updated_at=NOW() WHERE id=$1`, [order.listing_id]);
    // The seller is no longer obligated to pay for a concept they've sold.
    await client.query(
      `UPDATE subscriptions SET status='canceled', updated_at=now()
       WHERE user_id=$1 AND concept_id=$2 AND plan='maker' AND status='active'`,
      [order.seller_id, conceptId]);
    const done = await client.query(
      `UPDATE orders_transfers SET status='released' WHERE id=$1 RETURNING *`, [order.id]);
    await client.query('COMMIT');
    res.json({ order: done.rows[0], transferred_concept: conceptId });
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally { client.release(); }
}));

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT o.*, c.title FROM orders_transfers o
     JOIN listings l ON l.id=o.listing_id JOIN concepts c ON c.id=l.concept_id
     WHERE o.buyer_id=$1 OR o.seller_id=$1 ORDER BY o.created_at DESC`, [req.user.id]);
  res.json({ orders: r.rows });
}));

module.exports = router;
