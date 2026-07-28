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

// Create/return a connected account for a seller (KYC handled by Stripe).
async function createConnectedAccount(email) {
  const s = stripe();
  if (!s) return { ok: false, reason: 'stripe_not_configured' };
  const acct = await s.accounts.create({ type: 'express', email });
  return { ok: true, accountId: acct.id };
}

// Escrowed checkout: destination charge with application fee = platform take.
async function createEscrowCheckout({ amountCents, feeCents, sellerAccountId, orderId, successUrl, cancelUrl }) {
  const s = stripe();
  if (!s) return { ok: false, reason: 'stripe_not_configured' };
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
}

module.exports = { configured, createConnectedAccount, createEscrowCheckout };
