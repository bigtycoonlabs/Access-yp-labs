// Settling auctions when the clock runs out.
//
// An auction that never resolves is worse than no auction at all: the seller doesn't know if they
// sold, the high bidder doesn't know they won, and everyone quietly learns the market isn't real.
// This closes that loop.
//
// What it does NOT do, on purpose: it does not take anyone's money, does not transfer the project,
// and does not change the listing's status. It records the outcome and TELLS BOTH SIDES. The winner
// completes the purchase through the same flow as any other buyer, which keeps one payment path
// instead of two. Settlement is a fact being written down, not a transaction being forced.
//
// Safe to run often: the claim is an UPDATE that only matches rows still unsettled, so two servers
// racing cannot settle the same auction twice or send a duplicate email.

const { query } = require('../../config/db');
const { sendEmail } = require('../email');

const SITE = () => (process.env.CLIENT_URL || 'https://accessyplabs.com').replace(/\/+$/, '');
const money = (c) => '$' + ((Number(c) || 0) / 100).toFixed(2);

// Settle one auction. Returns what happened, or null if another worker got there first.
async function settleOne(listingId) {
  // The high bid, if there is one. Ties go to whoever bid first — the earlier commitment wins.
  const top = await query(
    `SELECT b.id, b.bidder_id, b.amount_cents, u.email, COALESCE(NULLIF(u.name,''),'there') AS name
       FROM bids b JOIN users u ON u.id = b.bidder_id
      WHERE b.listing_id = $1
      ORDER BY b.amount_cents DESC, b.created_at ASC
      LIMIT 1`, [listingId]);
  const winner = top.rows[0] || null;

  // The claim: only an unsettled auction matches, so this can run twice safely.
  const claim = await query(
    `UPDATE listings
        SET settled_at = now(), winner_id = $2, winning_bid_cents = $3
      WHERE id = $1 AND settled_at IS NULL
      RETURNING id, concept_id, seller_id`,
    [listingId, winner ? winner.bidder_id : null, winner ? winner.amount_cents : null]);
  if (!claim.rows.length) return null;              // someone else settled it first
  const listing = claim.rows[0];

  // Who the seller is, and what the thing is called.
  const meta = await query(
    `SELECT c.title, u.email AS seller_email, COALESCE(NULLIF(u.name,''),'there') AS seller_name
       FROM listings l JOIN concepts c ON c.id = l.concept_id JOIN users u ON u.id = l.seller_id
      WHERE l.id = $1`, [listingId]);
  const m = meta.rows[0] || {};
  const title = m.title || 'your project';
  const link = `${SITE()}/listing.html?id=${listingId}`;

  if (!winner) {
    // No bids. Say so plainly rather than leaving the seller to wonder.
    await sendEmail({
      to: m.seller_email,
      subject: `Your auction for ${title} has ended`,
      text: `Hi ${m.seller_name},\n\nThe auction for ${title} has ended, and it closed without any bids. `
        + `Nothing was sold and nothing was charged.\n\nThat happens, and it isn't a verdict on the idea — `
        + `it often just means the right buyer hadn't seen it yet. You can relist it, set a different starting `
        + `price, or add more to the listing to raise what it's worth: ${link}\n\n— Clay`,
    }).catch(() => {});
    return { listing_id: listingId, winner: null };
  }

  // Tell the winner they won, and how to finish.
  await sendEmail({
    to: winner.email,
    subject: `You won the auction for ${title}`,
    text: `Hi ${winner.name},\n\nYou had the winning bid of ${money(winner.amount_cents)} for ${title}.\n\n`
      + `Nothing has been charged yet — you complete the purchase yourself, here: ${link}\n\n`
      + `Take a moment to re-read what's included before you do. Nothing about this is automatic.\n\n— Clay`,
  }).catch(() => {});

  // And tell the seller.
  await sendEmail({
    to: m.seller_email,
    subject: `Your auction for ${title} ended at ${money(winner.amount_cents)}`,
    text: `Hi ${m.seller_name},\n\nThe auction for ${title} has ended. The winning bid was `
      + `${money(winner.amount_cents)}.\n\nThe buyer completes the purchase on their side — you'll be told when `
      + `they do, and the money moves through the same protected flow as any other sale. Nothing has been `
      + `transferred yet: ${link}\n\n— Clay`,
  }).catch(() => {});

  return { listing_id: listingId, winner: winner.bidder_id, amount_cents: winner.amount_cents };
}

// Settle every auction whose clock has run out. Never throws.
async function settleDue(limit = 25) {
  try {
    const due = await query(
      `SELECT id FROM listings
        WHERE format = 'auction'
          AND auction_close_at IS NOT NULL
          AND auction_close_at <= now()
          AND settled_at IS NULL
        ORDER BY auction_close_at ASC
        LIMIT $1`, [Math.min(Math.max(Number(limit) || 25, 1), 100)]);
    if (!due.rows.length) return { ok: true, settled: 0 };

    const results = [];
    for (const row of due.rows) {
      try {
        const out = await settleOne(row.id);
        if (out) results.push(out);
      } catch (e) {
        // One bad auction must never stop the rest from settling.
        console.error('auction settle error:', row.id, e && e.message);
      }
    }
    return { ok: true, settled: results.length, results };
  } catch (e) {
    return { ok: false, reason: 'error', error: e && e.message };
  }
}

module.exports = { settleDue, settleOne };
