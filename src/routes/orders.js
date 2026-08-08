const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, getClient } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ApiError } = require('../lib/http');
const { platformFeeCents, moverCommissionCents } = require('../lib/money');
const { normalizeSlug } = require('../lib/movers');
const stripe = require('../services/stripe');
const watchActivity = require('../services/clay/watchActivity');
const router = express.Router();

// Create an order for a live listing. All three acknowledgments are mandatory:
// the transfer agreement, the risk acknowledgment, and the no-refund policy.
router.post('/', authenticate, [
  body('listing_id').isUUID(),
  body('agreement_accepted').isBoolean(),
  body('risk_ack').isBoolean(),
  body('no_refund_ack').isBoolean(),
  body('mover').optional().isString(),
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

  // A concept sells once. If this listing already has an order that's been paid or settled,
  // no other buyer can claim it — this blocks the common double-purchase before any money
  // moves. (Abandoned, never-paid 'created' orders don't block, so a lapsed checkout can't
  // permanently lock a listing.) A rare simultaneous race is still caught at release, where
  // the listing row is locked and an already-sold listing is refused.
  const claimed = await query(
    `SELECT 1 FROM orders_transfers
      WHERE listing_id=$1 AND status IN ('in_escrow','proof_submitted','delivered','released') LIMIT 1`,
    [listing_id]);
  if (claimed.rows.length) {
    throw new ApiError(409, 'Someone is already completing the purchase of this concept, so it can’t be bought again.');
  }

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

  // Dream Mover attribution: if the buyer arrived through a mover's promo link, credit that
  // mover — but never in a self-dealing case (a mover can't earn on their own listing, and
  // can't earn on their own purchase). The commission itself is settled later, at release.
  let moverId = null;
  if (req.body.mover) {
    const slug = normalizeSlug(req.body.mover);
    if (slug) {
      const mv = await query("SELECT user_id FROM dream_movers WHERE slug=$1 AND status='active'", [slug]);
      const cand = mv.rows[0] && mv.rows[0].user_id;
      if (cand && cand !== req.user.id && cand !== listing.seller_id) moverId = cand;
    }
  }

  const r = await query(
    `INSERT INTO orders_transfers
       (listing_id, buyer_id, seller_id, amount_cents, platform_fee_cents,
        status, agreement_accepted, risk_ack, no_refund_ack, referred_by_mover_id, partner_active)
     VALUES ($1,$2,$3,$4,$5,'created',true,true,true,$6,$7) RETURNING *`,
    // partner_active is set EXPLICITLY rather than left null. It reads the same in the interface
    // either way today, but a null is not true: any later query filtering on partner_active = true
    // would silently miss every order ever created, which is the kind of bug that only surfaces
    // once someone relies on it. False when no partner was offered, so the flag always means
    // exactly what it says.
    [listing_id, req.user.id, listing.seller_id, amount, fee, moverId, !!listing.partner_offered]);
  const order = r.rows[0];

  // Attempt escrow checkout if a verified seller Connect account exists.
  const sa = await query('SELECT stripe_account_id FROM seller_accounts WHERE user_id=$1', [listing.seller_id]);
  let checkout = { ok: false, reason: 'seller_not_onboarded' };
  if (sa.rows[0] && sa.rows[0].stripe_account_id) {
    const base = (process.env.CLIENT_URL || '').startsWith('https') ? process.env.CLIENT_URL : 'https://accessyplabs.com';
    checkout = await stripe.createEscrowCheckout({
      amountCents: amount, feeCents: fee, sellerAccountId: sa.rows[0].stripe_account_id,
      orderId: order.id,
      successUrl: `${base}/orders/${order.id}?paid=1`,
      cancelUrl: `${base}/orders/${order.id}?canceled=1`,
    });
  }
  res.status(201).json({ order, checkout });
}));

// Seller submits proof of shipment for physical-goods concepts. Only AFTER payment is in
// escrow — never from 'created', or a concept could move without the buyer ever paying.
router.post('/:id/proof', authenticate, [body('proof_of_shipment').isString().notEmpty()],
  asyncHandler(async (req, res) => {
    const r = await query(
      `UPDATE orders_transfers SET status='proof_submitted', proof_of_shipment=$3
       WHERE id=$1 AND seller_id=$2 AND status IN ('in_escrow','proof_submitted') RETURNING *`,
      [req.params.id, req.user.id, req.body.proof_of_shipment]);
    if (!r.rows.length) throw new ApiError(404, 'Order not found, or not yet paid into escrow.');
    res.json({ order: r.rows[0] });
  }));

// Seller marks the transfer delivered. Only AFTER payment is in escrow — never from 'created'.
router.post('/:id/deliver', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `UPDATE orders_transfers SET status='delivered', delivered_at=NOW()
     WHERE id=$1 AND seller_id=$2 AND status IN ('in_escrow','proof_submitted') RETURNING *`,
    [req.params.id, req.user.id]);
  if (!r.rows.length) throw new ApiError(404, 'Order not found, or not yet paid into escrow.');
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
    const l = await client.query('SELECT concept_id, status FROM listings WHERE id=$1 FOR UPDATE', [order.listing_id]);
    if (!l.rows.length) throw new ApiError(404, 'The listing for this order no longer exists.');
    // A Dream Market concept is one-of-a-kind: it can only transfer to ONE buyer. Locking the
    // listing row above serializes concurrent releases; if another order already won this
    // listing (status 'sold'), we must NOT transfer the concept again — that would silently
    // overwrite the first buyer's ownership. Refuse honestly; this order's payment is refunded
    // rather than double-selling the concept.
    if (l.rows[0].status === 'sold') {
      throw new ApiError(409, 'This concept was already transferred to another buyer for this listing, so this order can’t be released. Your payment will be refunded — nothing was double-sold.');
    }
    const conceptId = l.rows[0].concept_id;

    // Clean transfer: buyer owns it, with the first month included; assets lock
    // as exclusive (they can't be resold without new work); listing marks sold.
    // access_expires_at is cleared, not set. It used to stamp 30 days from purchase, which
    // contradicts the line below marking the project free_forever — a buyer owns what they paid for
    // permanently. Nothing fades it today, because the expiry sweep skips purchased and free_forever
    // projects, so the stamp was harmless AND wrong: a landmine that only detonates if either of
    // those two guards is ever reordered or removed. Two rules disagreeing about the same project is
    // how someone loses a thing they paid for.
    await client.query(
      `UPDATE concepts SET owner_id=$2, origin='purchased',
         access_expires_at = NULL, expired_at = NULL, updated_at=NOW() WHERE id=$1`,
      [conceptId, order.buyer_id]);
    await client.query('UPDATE assets SET exclusive_locked=true, locked_at=now() WHERE concept_id=$1', [conceptId]);
    await client.query(`UPDATE listings SET status='sold', updated_at=NOW() WHERE id=$1`, [order.listing_id]);
    // The seller is no longer obligated to pay for a concept they've sold. Mark the row
    // canceled here and capture its Stripe id so we can stop the actual billing after commit.
    const sellerSub = await client.query(
      `UPDATE subscriptions SET status='canceled', updated_at=now()
       WHERE user_id=$1 AND concept_id=$2 AND plan='maker' AND status='active'
       RETURNING stripe_subscription_id`,
      [order.seller_id, conceptId]);
    // WHAT THE BUYER GETS: the project, permanently.
    //
    // This used to grant a 30-day 'maker' subscription on the bought project. That still technically
    // works — entitlement has a per-project maker check — but it is wrong now for two reasons. It
    // expires, so someone who PAID for a project would quietly lose the ability to export it after a
    // month; and it grants access through a plan we no longer sell, which is exactly the kind of
    // dependency that rots silently when the retired path is finally removed.
    //
    // Marking the project itself is simpler and matches what actually happened: they bought it, so
    // it is theirs. Same flag used for anyone who paid under the old per-project pricing.
    await client.query('UPDATE concepts SET free_forever = true WHERE id = $1', [conceptId]);
    const done = await client.query(
      `UPDATE orders_transfers SET status='released' WHERE id=$1 RETURNING *`, [order.id]);
    // People watching this dream should learn it is gone, rather than discovering it later.
    watchActivity.record(order.listing_id, 'sold', watchActivity.say.sold()).catch((e) => console.error('watch note failed:', e && e.message));
    // Dream Mover commission: if a mover drove this sale, accrue their 5% now — inside the
    // same transaction as the transfer, keyed UNIQUE by order so it can only ever be
    // recorded once. It's paid out of the platform's take; the seller's 80% is untouched.
    if (order.referred_by_mover_id) {
      await client.query(
        `INSERT INTO mover_earnings (mover_id, order_id, listing_id, amount_cents)
         VALUES ($1,$2,$3,$4) ON CONFLICT (order_id) DO NOTHING`,
        [order.referred_by_mover_id, order.id, order.listing_id, moverCommissionCents(order.amount_cents)]);
    }
    await client.query('COMMIT');
    // Stop the seller's real Stripe billing for the concept they just sold. Post-commit and
    // best-effort: never hold a DB lock across an external call, and a Stripe hiccup here must
    // not undo a completed, paid transfer — it's logged for follow-up instead.
    for (const s of sellerSub.rows) {
      if (!s.stripe_subscription_id) continue;
      try {
        const c = await stripe.cancelSubscription(s.stripe_subscription_id);
        if (!c.ok && c.reason !== 'stripe_not_configured') {
          console.error('release: could not cancel seller Stripe sub', s.stripe_subscription_id, '-', c.reason);
        }
      } catch (e) { console.error('release: seller Stripe cancel error', s.stripe_subscription_id, '-', e && e.message); }
    }
    res.json({ order: done.rows[0], transferred_concept: conceptId });
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally { client.release(); }
}));

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT o.*, c.title,
            l.partner_offered, l.partner_areas, l.partner_scope, l.partner_sessions, l.partner_weeks
       FROM orders_transfers o
       JOIN listings l ON l.id=o.listing_id JOIN concepts c ON c.id=l.concept_id
      WHERE o.buyer_id=$1 OR o.seller_id=$1 ORDER BY o.created_at DESC`, [req.user.id]);
  res.json({ orders: r.rows });
}));


// POST /api/orders/:id/partner/remove — the BUYER ends the launch partner arrangement.
//
// This is the buyer's protection, and it is deliberately unconditional: any reason, no reason, no
// notice period, no approval from anyone. They keep the project either way — the transfer is not
// contingent on the partnership, and ending it never claws back what they bought. Money is not
// touched here: the help was part of the price the seller set, and unwinding payments over a
// judgement call is exactly the kind of dispute this platform should not be adjudicating.
router.post('/:id/partner/remove', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `UPDATE orders_transfers
        SET partner_active = false, partner_removed_at = now()
      WHERE id = $1 AND buyer_id = $2 AND partner_active IS DISTINCT FROM false
      RETURNING id, listing_id`,
    [req.params.id, req.user.id]);
  if (!r.rows.length) {
    throw new ApiError(404, 'That order is not yours, or the launch partner has already been removed.');
  }
  res.json({
    removed: true,
    message: 'The launch partner has been removed. The project is still entirely yours — nothing about '
      + 'your ownership changes, and nothing was charged or refunded. If you want help again later, you '
      + 'can ask on the launch partner board.',
  });
}));

// POST /api/orders/:id/partner/restore — the buyer changes their mind.
router.post('/:id/partner/restore', authenticate, asyncHandler(async (req, res) => {
  const r = await query(
    `UPDATE orders_transfers SET partner_active = true, partner_removed_at = NULL
      WHERE id = $1 AND buyer_id = $2 AND partner_active = false
      RETURNING id`,
    [req.params.id, req.user.id]);
  if (!r.rows.length) throw new ApiError(404, 'That order is not yours, or the partner is already active.');
  res.json({ restored: true, message: 'The launch partner is active again. Reach out to them directly to pick things back up.' });
}));

module.exports = router;
