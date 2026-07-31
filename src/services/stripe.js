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

// Create a connected account for a seller (KYC handled by Stripe).
async function createConnectedAccount(email) {
  const s = stripe();
  if (!s) return { ok: false, reason: 'stripe_not_configured' };
  try {
    const acct = await s.accounts.create({ type: 'express', email });
    return { ok: true, accountId: acct.id };
  } catch (err) {
    console.error('createConnectedAccount FAILED —', err && err.type, err && err.code, '-', err && err.message);
    return { ok: false, reason: 'stripe_error', detail: (err && (err.code || err.type)) || 'unknown' };
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
    return { ok: false, reason: 'stripe_error', detail: (err && (err.code || err.type)) || 'unknown' };
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
    });
    return { ok: true, url: session.url, sessionId: session.id };
  } catch (err) {
    console.error('createEscrowCheckout FAILED — type:', err && err.type, '| code:', err && err.code,
      '| param:', err && err.param, '| message:', err && err.message);
    return { ok: false, reason: 'stripe_error', detail: (err && (err.code || err.type)) || 'unknown',
      message: 'Could not start checkout with the payment processor, so nothing was charged. Please try again in a moment.' };
  }
}


// Consultant session checkout: a destination charge, exactly like a marketplace transfer.
// The client pays the full fee; the platform's cut is the application fee; the rest is routed
// to the consultant's own connected account. Same proven money path — consultants get paid
// through Stripe like any other payee, and the door is open to future paid roles.
async function createConsultCheckout({ amountCents, feeCents, consultantAccountId, engagementId, email, successUrl, cancelUrl }) {
  const s = stripe();
  if (!s) return { ok: false, reason: 'stripe_not_configured' };
  try {
    const session = await s.checkout.sessions.create({
      mode: 'payment',
      customer_email: email || undefined,
      line_items: [{ price_data: { currency: 'usd', unit_amount: amountCents,
        product_data: { name: `YP Labs consultant session #${engagementId}` } }, quantity: 1 }],
      payment_intent_data: {
        application_fee_amount: feeCents,
        transfer_data: { destination: consultantAccountId },
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { kind: 'consult', engagement_id: engagementId },
    });
    return { ok: true, url: session.url, sessionId: session.id };
  } catch (err) {
    console.error('createConsultCheckout FAILED — type:', err && err.type, '| code:', err && err.code,
      '| param:', err && err.param, '| message:', err && err.message);
    return { ok: false, reason: 'stripe_error', detail: (err && (err.code || err.type)) || 'unknown',
      message: 'Could not start checkout with the payment processor, so nothing was charged. Please try again in a moment.' };
  }
}


// Cancel a live subscription so billing actually STOPS. Flipping our DB status alone
// never stops Stripe from charging the card — this does.
async function cancelSubscription(subscriptionId) {
  const s = stripe();
  if (!s) return { ok: false, reason: 'stripe_not_configured' };
  try {
    await s.subscriptions.cancel(subscriptionId);
    return { ok: true };
  } catch (err) {
    // Already-canceled subscriptions report as such — treat that as success (idempotent).
    if (err && /No such subscription|already been canceled|resource_missing/i.test(err.message || '')) {
      return { ok: true, alreadyGone: true };
    }
    return { ok: false, reason: 'stripe_error', message: err.message };
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
    });
    return { ok: true, url: session.url, sessionId: session.id };
  } catch (err) {
    // Never let a Stripe error become an opaque 500. Log the real cause (Railway logs)
    // and return a clean, honest message the UI can speak.
    console.error('createPlanCheckout FAILED — type:', err && err.type, '| code:', err && err.code,
      '| param:', err && err.param, '| message:', err && err.message);
    return { ok: false, reason: 'stripe_error', detail: (err && (err.code || err.type)) || 'unknown',
      message: 'Could not start checkout with the payment processor, so nothing was charged. Please try again in a moment.' };
  }
}

module.exports = { configured, constructEvent, createPlanCheckout, cancelSubscription, createConnectedAccount, createAccountLink, retrieveAccount, createEscrowCheckout, createConsultCheckout };
