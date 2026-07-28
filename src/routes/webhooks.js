const { query } = require('../config/db');
const stripe = require('../services/stripe');

// Stripe webhook. Mounted with express.raw BEFORE express.json in server.js.
// Only a verified, real payment moves an order into escrow — we never mark an
// order paid on optimism. Every event is de-duplicated via stripe_events.
async function stripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const parsed = stripe.constructEvent(req.body, sig);
  if (!parsed.ok) {
    // Not configured -> acknowledge without acting. Bad signature -> reject.
    if (parsed.reason === 'stripe_not_configured') return res.status(200).json({ received: true, acted: false });
    return res.status(400).json({ error: 'Invalid signature.' });
  }
  const event = parsed.event;

  // Idempotency: record the event id; skip if we've seen it.
  try {
    const dup = await query('SELECT id FROM stripe_events WHERE id=$1', [event.id]);
    if (dup.rows.length) return res.status(200).json({ received: true, duplicate: true });
    await query('INSERT INTO stripe_events (id, event_type) VALUES ($1,$2)', [event.id, event.type]);
  } catch (e) { console.error('stripe_events insert failed:', e.message); }

  try {
    if (event.type === 'checkout.session.completed') {
      const orderId = event.data.object.metadata && event.data.object.metadata.order_id;
      if (orderId) {
        await query(
          `UPDATE orders_transfers SET status='in_escrow'
           WHERE id=$1 AND status IN ('created')`, [orderId]);
      }
    } else if (event.type === 'account.updated') {
      const acct = event.data.object;
      const status = acct.charges_enabled && acct.details_submitted ? 'verified' : 'pending';
      await query('UPDATE seller_accounts SET kyc_status=$2 WHERE stripe_account_id=$1', [acct.id, status]);
    }
  } catch (e) {
    console.error('webhook handling error:', e.message);
    return res.status(500).json({ error: 'handler_failed' });
  }
  res.json({ received: true });
}

module.exports = { stripeWebhook };
