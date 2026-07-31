const { query } = require('../config/db');
const stripe = require('../services/stripe');
const { planCents } = require('../lib/money');

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

  // Idempotency: skip if we've already fully handled this event. We record the
  // event as handled only AFTER processing succeeds (below) — so a handler failure
  // returns 500 WITHOUT marking it seen, letting Stripe's retry actually re-process
  // it instead of being deduped away and the payment silently lost.
  try {
    const dup = await query('SELECT id FROM stripe_events WHERE id=$1', [event.id]);
    if (dup.rows.length) return res.status(200).json({ received: true, duplicate: true });
  } catch (e) { console.error('stripe_events check failed:', e.message); }

  try {
    if (event.type === 'checkout.session.completed') {
      const md = event.data.object.metadata || {};
      if (md.kind === 'subscription' && md.user_id && md.plan) {
        const price = planCents(md.plan);
        const conceptId = md.concept_id && md.concept_id.length ? md.concept_id : null;
        const stripeSubId = event.data.object.subscription || null;
        // ON CONFLICT keeps this idempotent at the row level: if Stripe delivers the same
        // checkout event concurrently (both deliveries passing the dedup check before either
        // records it), the second insert of the same Stripe subscription no-ops instead of
        // creating a duplicate active subscription for a single payment.
        await query(
          `INSERT INTO subscriptions (user_id, plan, concept_id, status, price_cents, stripe_subscription_id)
           VALUES ($1,$2,$3,'active',$4,$5)
           ON CONFLICT (stripe_subscription_id) DO NOTHING`, [md.user_id, md.plan, conceptId, price, stripeSubId]);
      } else if (md.order_id) {
        await query(
          `UPDATE orders_transfers SET status='in_escrow'
           WHERE id=$1 AND status IN ('created')`, [md.order_id]);
      }
    } else if (event.type === 'invoice.payment_failed') {
      // A failed renewal must revoke access — mark the subscription past_due so
      // entitlement (which requires status='active') stops covering the concept.
      const subId = event.data.object.subscription;
      if (subId) await query(
        `UPDATE subscriptions SET status='past_due', updated_at=now() WHERE stripe_subscription_id=$1`, [subId]);
    } else if (event.type === 'invoice.payment_succeeded') {
      // A successful renewal keeps/reactivates access.
      const subId = event.data.object.subscription;
      if (subId) await query(
        `UPDATE subscriptions SET status='active', updated_at=now() WHERE stripe_subscription_id=$1 AND status<>'canceled'`, [subId]);
    } else if (event.type === 'customer.subscription.deleted') {
      const subId = event.data.object.id;
      if (subId) await query(
        `UPDATE subscriptions SET status='canceled', updated_at=now() WHERE stripe_subscription_id=$1`, [subId]);
    } else if (event.type === 'account.updated') {
      const acct = event.data.object;
      const status = acct.charges_enabled && acct.details_submitted ? 'verified' : 'pending';
      await query('UPDATE seller_accounts SET kyc_status=$2 WHERE stripe_account_id=$1', [acct.id, status]);
    }
  } catch (e) {
    console.error('webhook handling error:', e.message);
    // Not recorded as handled -> Stripe will retry and we'll process it next time.
    return res.status(500).json({ error: 'handler_failed' });
  }

  // Mark handled only after successful processing, so a failed handler is safely retried.
  try {
    await query('INSERT INTO stripe_events (id, event_type) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING', [event.id, event.type]);
  } catch (e) { console.error('stripe_events insert failed:', e.message); }

  res.json({ received: true });
}

module.exports = { stripeWebhook };
