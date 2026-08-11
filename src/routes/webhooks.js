const { query } = require('../config/db');
const { notifyStaff } = require('../services/clay/staffNotify');
const stripe = require('../services/stripe');
const imageBudget = require('../services/clay/imageBudget');
const { recordedPlanCents } = require('../lib/money');

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
  } catch (e) {
    // The de-duplication READ failed, so we cannot tell whether this event was already handled.
    // Processing continues, because refusing would drop a real payment — but a retry of something
    // already processed is now possible, and that is worth a person knowing about.
    console.error('stripe_events check failed:', e.message);
    notifyStaff({
      kind: 'webhook_dedupe_unavailable',
      dedupeKey: 'webhook-dedupe-read-' + new Date().toISOString().slice(0, 13),
      subject: 'Payment de-duplication could not be checked',
      body: `A Stripe webhook arrived and we could not read the de-duplication table, so we cannot `
        + `tell whether it had already been handled.\n\nEvent: ${event.id} (${event.type})\n`
        + `Reason: ${e.message}\n\nIt was processed anyway, because refusing would drop a real `
        + 'payment. If Stripe retries it, the same event could be processed twice — worth checking '
        + 'this order or subscription by hand.',
    }).catch(() => {});
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const md = event.data.object.metadata || {};
      if (md.kind === 'subscription' && md.user_id && md.plan) {
        // recordedPlanCents, not planCents: this is recording what a person ALREADY pays, which
        // includes retired plans a legacy subscriber still holds. planCents refuses to price those
        // — correctly, since they must never be sold again — but refusing here meant a null price
        // into a NOT NULL column, a failed insert, a 500, and Stripe retrying forever while the
        // subscription never registered.
        const price = recordedPlanCents(md.plan);
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
      // A 'consult' branch settled paid consultant sessions here. Retired with the product. Nothing
      // can create such a session any more (the routes 410 and the checkout function is gone), and
      // no engagement was ever paid for, so there is no in-flight event this could still be needed
      // for. An unreachable branch that writes money is worth deleting rather than keeping.
      } else if (md.kind === 'image_pack' && md.concept_id && md.images) {
        // Extras image pack. Grant the credits to the concept exactly once, keyed by the Stripe
        // session id: the purchase row is inserted first, and credits are added only if that
        // insert actually happened (so a duplicate event delivery can't double-credit).
        const images = parseInt(md.images, 10) || 0;
        const sessionId = event.data.object.id;
        if (images > 0 && sessionId) {
          const ins = await query(
            `INSERT INTO image_pack_purchases (stripe_session_id, concept_id, user_id, pack_id, images, price_cents)
             VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (stripe_session_id) DO NOTHING RETURNING id`,
            [sessionId, md.concept_id, md.user_id || null, md.pack_id || null, images,
             event.data.object.amount_total || 0]);
          if (ins.rows.length) await imageBudget.grantCredits(md.concept_id, images);
        }
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
  } catch (e) {
    // WORSE THAN IT LOOKS. The event was processed successfully but NOT recorded, so Stripe's retry
    // will find no duplicate and run the whole handler again — recording a subscription twice, or
    // moving an order into escrow twice, for one real payment. Nothing downstream would notice,
    // because each run looks correct on its own.
    console.error('stripe_events insert failed:', e.message);
    notifyStaff({
      kind: 'webhook_not_recorded',
      dedupeKey: 'webhook-insert-' + event.id,
      subject: 'A payment event was handled but not recorded — it may be processed twice',
      body: `A Stripe webhook was processed successfully, but writing it to the de-duplication table `
        + `failed. Stripe retries unacknowledged events, and the retry will NOT be recognised as a `
        + `duplicate.\n\nEvent: ${event.id} (${event.type})\nReason: ${e.message}\n\n`
        + 'Nothing is wrong with the payment itself. The risk is that it gets applied a second time, '
        + 'which nothing downstream would notice because each run looks correct on its own. Worth '
        + 'checking the affected order or subscription for a duplicate.',
    }).catch(() => {});
  }

  res.json({ received: true });
}

module.exports = { stripeWebhook };
