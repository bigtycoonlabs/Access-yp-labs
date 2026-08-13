// Thin Stripe Connect wrapper. The platform is always a neutral third party:
// funds move buyer -> platform -> seller, with the 20% application fee retained.
// Crypto is never a payment method here (concepts about crypto are still sellable).
let Stripe = null;
try { Stripe = require('stripe'); } catch (_) { /* optional until deployed */ }

function stripe() {
  if (!Stripe || !process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}
const configured = () => !!stripe();

// Create a connected account for a seller (KYC handled by Stripe). We request the `transfers`
// capability up front: this is a destination-charge marketplace (the buyer pays the platform, and
// the sale proceeds are routed to the seller's connected account via transfer_data.destination), so
// the seller's account needs `transfers` to receive money. Without a requested capability Stripe has
// nothing to collect and refuses to build an onboarding link — which is exactly why setup was
// erroring. card_payments is intentionally NOT requested: the platform is the merchant of record.
async function createConnectedAccount(email) {
  const s = stripe();
  if (!s) return { ok: false, reason: 'stripe_not_configured' };
  try {
    const acct = await s.accounts.create({
      type: 'express',
      email,
      capabilities: { transfers: { requested: true } },
    });
    return { ok: true, accountId: acct.id };
  } catch (err) {
    console.error('createConnectedAccount FAILED —', err && err.type, err && err.code, '-', err && err.message);
    return { ok: false, reason: 'stripe_error', detail: (err && (err.code || err.type)) || 'unknown',
      message: (err && err.message) || null };
  }
}

// Hosted onboarding link the seller completes to enable payouts.
async function createAccountLink({ accountId, refreshUrl, returnUrl }) {
  const s = stripe();
  if (!s) return { ok: false, reason: 'stripe_not_configured' };
  try {
    const link = await s.accountLinks.create({
      account: accountId, refresh_url: refreshUrl, return_url: returnUrl,
      type: 'account_onboarding',
    });
    return { ok: true, url: link.url };
  } catch (err) {
    console.error('createAccountLink FAILED —', err && err.type, err && err.code, '-', err && err.message);
    return { ok: false, reason: 'stripe_error', detail: (err && (err.code || err.type)) || 'unknown',
      message: (err && err.message) || null };
  }
}

// Sync payout readiness for a connected account.
async function retrieveAccount(accountId) {
  const s = stripe();
  if (!s) return { ok: false, reason: 'stripe_not_configured' };
  try {
    const a = await s.accounts.retrieve(accountId);
    return { ok: true, charges_enabled: a.charges_enabled, details_submitted: a.details_submitted, payouts_enabled: a.payouts_enabled };
  } catch (err) {
    console.error('retrieveAccount FAILED —', err && err.type, err && err.code, '-', err && err.message);
    return { ok: false, reason: 'stripe_error', detail: (err && (err.code || err.type)) || 'unknown' };
  }
}

// Escrowed checkout: destination charge with application fee = platform take.
async function createEscrowCheckout({ amountCents, feeCents, sellerAccountId, orderId, successUrl, cancelUrl }) {
  const s = stripe();
  if (!s) return { ok: false, reason: 'stripe_not_configured' };
  try {
    const session = await s.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price_data: { currency: 'usd', unit_amount: amountCents,
        product_data: { name: `YP Labs transfer #${orderId}` } }, quantity: 1 }],
      payment_intent_data: {
        application_fee_amount: feeCents,
        transfer_data: { destination: sellerAccountId },
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { order_id: orderId },
      managed_payments: { enabled: false }, // standard checkout — see note on the plan checkout
    });
    return { ok: true, url: session.url, sessionId: session.id };
  } catch (err) {
    console.error('createEscrowCheckout FAILED — type:', err && err.type, '| code:', err && err.code,
      '| param:', err && err.param, '| message:', err && err.message);
    return { ok: false, reason: 'stripe_error', detail: (err && (err.code || err.type)) || 'unknown',
      message: 'Could not start checkout with the payment processor, so nothing was charged. Please try again in a moment.' };
  }
}


// CONSULTANT SESSION CHECKOUT — REMOVED.
//
// This opened a real $150 Stripe checkout, splitting $30 to the platform and $120 to a consultant's
// connected account. Paid consultant sessions are retired. The routes that called it have returned
// 410 since they were withdrawn, so nothing reached it — but a working payment function for a
// product we no longer sell is a live wire behind a closed door, and the door is the only thing
// stopping it. Deleting the function is what makes the retirement real.
//
// Zero engagements were ever created and zero were ever paid, so nothing is stranded by this.
// Launch Partners replaced consultants and carries no fee, so it needs no checkout of its own.


// Cancel a live subscription so billing actually STOPS. Flipping our DB status alone
// never stops Stripe from charging the card — this does.
async function cancelSubscription(subscriptionId, opts) {
  const s = stripe();
  if (!s) return { ok: false, reason: 'stripe_not_configured' };
  const atPeriodEnd = !!(opts && opts.atPeriodEnd);
  try {
    if (atPeriodEnd) {
      // Stop the renewal but let the person keep the access they've already paid for through
      // the end of the current billing period. Stripe fires customer.subscription.deleted at
      // period end, which flips our row to canceled.
      await s.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    } else {
      await s.subscriptions.cancel(subscriptionId);
    }
    return { ok: true, atPeriodEnd };
  } catch (err) {
    // Already-canceled subscriptions report as such — treat that as success (idempotent).
    if (err && /No such subscription|already been canceled|resource_missing/i.test(err.message || '')) {
      return { ok: true, alreadyGone: true };
    }
    return { ok: false, reason: 'stripe_error', message: err.message };
  }
}

// Pay an Affiliate their earned commission: a Connect transfer from the platform balance
// to the mover's own connected account (the same account a seller receives sale proceeds
// on). The idempotency key makes a retry return the SAME transfer, so a crash between the
// transfer and the ledger write can never double-pay.
async function createTransfer({ amountCents, destinationAccountId, idempotencyKey, metadata }) {
  const s = stripe();
  if (!s) return { ok: false, reason: 'stripe_not_configured' };
  try {
    const tr = await s.transfers.create(
      { amount: amountCents, currency: 'usd', destination: destinationAccountId, metadata: metadata || {} },
      idempotencyKey ? { idempotencyKey } : undefined);
    return { ok: true, transferId: tr.id };
  } catch (err) {
    console.error('createTransfer FAILED — type:', err && err.type, '| code:', err && err.code,
      '| message:', err && err.message);
    return { ok: false, reason: 'stripe_error', detail: (err && (err.code || err.type)) || 'unknown',
      message: (err && err.message) || 'The payout could not be sent.' };
  }
}

// Verify + parse a webhook event from the raw request body.
function constructEvent(rawBody, signature) {
  const s = stripe();
  if (!s || !process.env.STRIPE_WEBHOOK_SECRET) return { ok: false, reason: 'stripe_not_configured' };
  try {
    const event = s.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
    return { ok: true, event };
  } catch (err) {
    return { ok: false, reason: 'bad_signature', message: err.message };
  }
}


// Subscription or one-time checkout for platform plans (Clay access).
// sculptor -> recurring monthly (unlimited); maker -> recurring monthly (per concept).
async function createPlanCheckout({ mode, priceCents, planName, userId, plan, conceptId, email, successUrl, cancelUrl }) {
  const s = stripe();
  if (!s) return { ok: false, reason: 'stripe_not_configured' };
  const recurring = mode === 'subscription' ? { interval: 'month' } : undefined;
  try {
    const session = await s.checkout.sessions.create({
      mode,
      customer_email: email || undefined,
      line_items: [{ price_data: { currency: 'usd', unit_amount: priceCents,
        product_data: { name: planName }, recurring }, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { kind: 'subscription', user_id: userId, plan, concept_id: conceptId || '' },
      // Managed Payments is on by default on this account and requires a product tax code on
      // every inline price; we don't set one, so Stripe rejected the checkout. Disable it here
      // to use standard checkout. To adopt Managed Payments (Stripe handling sales tax), set a
      // chosen product tax code on each price instead — a deliberate tax decision.
      managed_payments: { enabled: false },
    });
    return { ok: true, url: session.url, sessionId: session.id };
  } catch (err) {
    // Never let a Stripe error become an opaque 500. Log the real cause (Railway logs)
    // and return a clean, honest message the UI can speak.
    console.error('createPlanCheckout FAILED — type:', err && err.type, '| code:', err && err.code,
      '| param:', err && err.param, '| message:', err && err.message);
    return { ok: false, reason: 'stripe_error', detail: (err && (err.code || err.type)) || 'unknown',
      stripe_type: (err && err.type) || null, stripe_code: (err && err.code) || null,
      stripe_param: (err && err.param) || null, stripe_message: (err && err.message) || null,
      message: 'Could not start checkout with the payment processor, so nothing was charged. Please try again in a moment.' };
  }
}

// One-time purchase of an "Extras" image pack for a concept. Platform revenue (no seller
// transfer): the person buys extra image credits that attach to one concept.
async function createImagePackCheckout({ userId, conceptId, pack, email, successUrl, cancelUrl }) {
  const s = stripe();
  if (!s) return { ok: false, reason: 'stripe_not_configured' };
  try {
    const session = await s.checkout.sessions.create({
      mode: 'payment',
      customer_email: email || undefined,
      line_items: [{ price_data: { currency: 'usd', unit_amount: pack.price_cents,
        product_data: { name: 'Access YP Labs — ' + pack.label + ' (Extras)' } }, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { kind: 'image_pack', user_id: userId, concept_id: conceptId, pack_id: pack.id, images: String(pack.images) },
      managed_payments: { enabled: false }, // standard checkout — see note on the plan checkout
    });
    return { ok: true, url: session.url, sessionId: session.id };
  } catch (err) {
    console.error('createImagePackCheckout FAILED — type:', err && err.type, '| code:', err && err.code,
      '| param:', err && err.param, '| message:', err && err.message);
    return { ok: false, reason: 'stripe_error', detail: (err && (err.code || err.type)) || 'unknown',
      stripe_type: (err && err.type) || null, stripe_code: (err && err.code) || null,
      stripe_param: (err && err.param) || null, stripe_message: (err && err.message) || null,
      message: 'Could not start checkout with the payment processor, so nothing was charged. Please try again in a moment.' };
  }
}

// ---- Storefront (creator's own e-commerce) --------------------------------------------------
// A creator's store sells THEIR products to THEIR customers. Per Stripe's guidance for
// "an e-commerce platform for independent sellers," this is a DIRECT charge on the creator's
// connected account: the creator is the merchant of record, the creator bears Stripe's processing
// fee, and the platform takes NO application fee. Confirmed against Stripe docs: destination
// charges always bill the fee to the platform, so a direct charge is the correct model here.

// Storefronts need the card_payments capability (payouts-only accounts only requested `transfers`).
// Requesting an already-active capability is a no-op, so this is safe to call every time.
async function ensureCardPayments(accountId) {
  const s = stripe();
  if (!s) return { ok: false, reason: 'stripe_not_configured' };
  try {
    await s.accounts.update(accountId, {
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    });
    return { ok: true };
  } catch (err) {
    console.error('ensureCardPayments FAILED —', err && err.type, err && err.code, '-', err && err.message);
    return { ok: false, error: (err && err.message) || 'unknown' };
  }
}

// Countries a physical order can ship to. Broad common set; a seller needing more is a later tweak.
const SHIP_COUNTRIES = ['US', 'CA', 'GB', 'AU', 'NZ', 'IE', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'NO', 'DK', 'FI', 'BE', 'AT', 'PT', 'CH', 'PL', 'JP', 'SG', 'MX', 'BR'];

function formatShipping(details) {
  if (!details) return null;
  const a = details.address || {};
  const parts = [details.name, a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(' '), a.country].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

// Start a storefront checkout: a DIRECT charge created ON the seller's connected account. No
// application_fee_amount, so the platform takes nothing; the seller settles the Stripe fee. For a
// physical product, collect a shipping address so the seller knows where to ship.
async function createStoreCheckout({ amountCents, currency, productName, sellerAccountId, orderId, successUrl, cancelUrl, collectShipping }) {
  const s = stripe();
  if (!s) return { ok: false, reason: 'stripe_not_configured' };
  try {
    const params = {
      mode: 'payment',
      line_items: [{
        price_data: { currency: currency || 'usd', product_data: { name: productName }, unit_amount: amountCents },
        quantity: 1,
      }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: orderId,
      metadata: { kind: 'store_order', order_id: orderId },
      payment_intent_data: { metadata: { kind: 'store_order', order_id: orderId } },
      managed_payments: { enabled: false }, // REQUIRED on a Connect direct-charge session (SMP can't be used with Connect)
    };
    if (collectShipping) params.shipping_address_collection = { allowed_countries: SHIP_COUNTRIES };
    const session = await s.checkout.sessions.create(params, { stripeAccount: sellerAccountId });
    return { ok: true, id: session.id, url: session.url };
  } catch (err) {
    console.error('createStoreCheckout FAILED — type:', err && err.type, '| code:', err && err.code, '-', err && err.message);
    return { ok: false, error: (err && err.message) || 'unknown',
      message: 'Could not start checkout with the payment processor, so nothing was charged. Please try again in a moment.' };
  }
}

// Verify a storefront checkout by retrieving the session ON the connected account. This is the
// source of truth for "paid" — the platform only ever marks an order paid from Stripe's own
// payment_status, never from a redirect alone.
async function retrieveStoreSession({ sessionId, sellerAccountId }) {
  const s = stripe();
  if (!s) return { ok: false, reason: 'stripe_not_configured' };
  try {
    const session = await s.checkout.sessions.retrieve(sessionId, { stripeAccount: sellerAccountId });
    return { ok: true,
      payment_status: session.payment_status,
      amount_total: session.amount_total,
      currency: session.currency,
      customer_email: (session.customer_details && session.customer_details.email) || null,
      shipping: formatShipping(session.shipping_details || (session.collected_information && session.collected_information.shipping_details)),
      metadata: session.metadata || {} };
  } catch (err) {
    console.error('retrieveStoreSession FAILED —', err && err.type, err && err.code, '-', err && err.message);
    return { ok: false, error: (err && err.message) || 'unknown' };
  }
}


// REFUND A PAYMENT. There was no way to do this at all, while the code told buyers "your payment
// will be refunded" after a double-sale. Follows the same contract as everything else here: it
// RESOLVES with { ok:false, reason } rather than throwing, so callers must read the result — a
// refund that silently failed would be the worst possible version of this function.
async function refundPayment({ paymentIntent, sessionId, reason = 'requested_by_customer' }) {
  const s = stripe();
  if (!s) return { ok: false, reason: 'stripe_not_configured' };
  try {
    let intent = paymentIntent;
    // A checkout session is what we store at purchase; the payment intent hangs off it.
    if (!intent && sessionId) {
      const sess = await s.checkout.sessions.retrieve(sessionId);
      intent = sess && (typeof sess.payment_intent === 'string' ? sess.payment_intent : (sess.payment_intent && sess.payment_intent.id));
    }
    if (!intent) return { ok: false, reason: 'no_payment_reference' };
    const r = await s.refunds.create({ payment_intent: intent, reason });
    return { ok: true, refundId: r.id, status: r.status };
  } catch (err) {
    return { ok: false, reason: 'stripe_error',
      detail: (err && (err.code || err.type)) || 'unknown', message: err && err.message };
  }
}

module.exports = {
  refundPayment, configured, constructEvent, createPlanCheckout, cancelSubscription, createConnectedAccount, createAccountLink, retrieveAccount, createEscrowCheckout, createImagePackCheckout, createTransfer, ensureCardPayments, createStoreCheckout, retrieveStoreSession };
