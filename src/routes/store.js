// Public storefront checkout. A buyer purchasing a creator's product is a DIRECT charge on the
// creator's own Stripe Connect account — the creator is the merchant, bears Stripe's fee, and the
// platform takes nothing. These endpoints are public (buyers aren't logged in). The price is
// always looked up server-side and never trusted from the client, and an order is only ever marked
// paid from Stripe's real payment_status — never from a redirect alone.
const express = require('express');
const { query } = require('../config/db');
const { asyncHandler } = require('../lib/http');
const stripe = require('../services/stripe');
const router = express.Router();

function baseUrl() {
  return (process.env.CLIENT_URL || '').startsWith('https') ? process.env.CLIENT_URL : 'https://accessyplabs.com';
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function page(title, body) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>' + esc(title) + '</title>'
    + '<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:12vh auto;padding:0 20px;line-height:1.6;color:#1a1a1a}h1{font-size:1.5rem}a{color:#0645ad}</style>'
    + '</head><body><main>' + body + '</main></body></html>';
}

// Return from Stripe — verify the session on the connected account and mark paid idempotently.
router.get('/return', asyncHandler(async (req, res) => {
  const orderId = req.query.order || '';
  const row = (await query(
    `SELECT o.id, o.seller_account_id, o.stripe_session_id, o.status, o.product_name, o.shipping,
            sp.kind, sp.fulfillment_url
       FROM store_orders o LEFT JOIN store_products sp ON sp.id = o.product_id
      WHERE o.id=$1`, [orderId])).rows[0];
  if (!row) return res.status(404).type('html').send(page('Order not found', '<h1>Order not found</h1><p>We couldn’t find that order.</p>'));

  function confirmedBody(shipping) {
    var b = '<h1>Thank you — your order is confirmed</h1><p>Your purchase of ' + esc(row.product_name) + ' is complete.</p>';
    if (row.kind === 'digital' && row.fulfillment_url) {
      b += '<p><a href="' + esc(row.fulfillment_url) + '">Access your purchase</a></p>';
    } else if (row.kind === 'digital') {
      b += '<p>This is a digital item. The seller will send you access shortly.</p>';
    }
    if (shipping) b += '<p>It will be shipped to: ' + esc(shipping) + '.</p>';
    return b;
  }

  if (row.status === 'paid') {
    return res.type('html').send(page('Thank you', confirmedBody(row.shipping)));
  }
  if (!row.stripe_session_id) {
    return res.type('html').send(page('Pending', '<h1>We’re still confirming your order</h1><p>If you completed payment, it will confirm shortly.</p>'));
  }
  const sess = await stripe.retrieveStoreSession({ sessionId: row.stripe_session_id, sellerAccountId: row.seller_account_id });
  if (sess.ok && sess.payment_status === 'paid') {
    await query(
      "UPDATE store_orders SET status='paid', paid_at=now(), buyer_email=COALESCE(buyer_email,$2), shipping=COALESCE(shipping,$3) WHERE id=$1 AND status<>'paid'",
      [orderId, sess.customer_email, sess.shipping || null]);
    return res.type('html').send(page('Thank you', confirmedBody(sess.shipping || row.shipping)));
  }
  return res.type('html').send(page('Pending', '<h1>We’re still confirming your order</h1><p>If you completed payment, it will confirm shortly. Nothing extra was charged.</p>'));
}));

// Start a checkout for one product.
router.post('/:conceptId/checkout', asyncHandler(async (req, res) => {
  const conceptId = req.params.conceptId;
  const productId = (req.body && (req.body.product_id || req.body.productId)) || '';
  if (!productId) {
    return res.status(400).type('html').send(page('Missing product', '<h1>Something went wrong</h1><p>No product was specified. Nothing was charged.</p>'));
  }

  // A storefront can only take money while the plan behind it is live. Checked at the moment of
  // CHECKOUT rather than only when the button was drawn, because a stale page, a cached copy or a
  // direct post could otherwise still start a payment on a site that is no longer public. Nobody
  // should be able to be charged through a shopfront that is not supposed to be open.
  if (!(await siteAccess.publiclyVisible(conceptId))) {
    return res.status(403).type('html').send(page('Not available',
      '<h1>This shop isn’t open</h1><p>Nothing was charged. This storefront isn’t currently available — '
      + 'if it’s yours, it needs an active plan before it can take payments.</p>'));
  }
  const pr = await query(
    `SELECT sp.id, sp.name, sp.price_cents, sp.currency, sp.active, sp.kind, c.owner_id
     FROM store_products sp JOIN concepts c ON c.id = sp.concept_id
     WHERE sp.id = $1 AND sp.concept_id = $2`, [productId, conceptId]);
  const product = pr.rows[0];
  if (!product || product.active === false) {
    return res.status(404).type('html').send(page('Unavailable', '<h1>That item isn’t available</h1><p>This product can’t be purchased right now. Nothing was charged.</p>'));
  }
  if (!stripe.configured()) {
    return res.status(200).type('html').send(page('Not taking payments', '<h1>This store isn’t taking payments yet</h1><p>Payments aren’t set up. Nothing was charged.</p>'));
  }
  const acctRow = (await query('SELECT stripe_account_id FROM seller_accounts WHERE user_id=$1', [product.owner_id])).rows[0];
  const sellerAccountId = acctRow && acctRow.stripe_account_id;
  if (!sellerAccountId) {
    return res.status(200).type('html').send(page('Not taking payments', '<h1>This store isn’t taking payments yet</h1><p>The seller hasn’t finished setting up payments. Nothing was charged.</p>'));
  }
  const acct = await stripe.retrieveAccount(sellerAccountId);
  if (!(acct.ok && acct.charges_enabled)) {
    return res.status(200).type('html').send(page('Not taking payments', '<h1>This store isn’t taking payments yet</h1><p>The seller’s payment setup isn’t verified yet. Nothing was charged.</p>'));
  }
  const ins = await query(
    `INSERT INTO store_orders (concept_id, product_id, seller_account_id, amount_cents, currency, product_name, status)
     VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING id`,
    [conceptId, product.id, sellerAccountId, product.price_cents, product.currency, product.name]);
  const orderId = ins.rows[0].id;
  const cancelUrl = req.get('referer') || (baseUrl() + '/');
  const session = await stripe.createStoreCheckout({
    amountCents: product.price_cents, currency: product.currency, productName: product.name,
    sellerAccountId, orderId,
    successUrl: `${baseUrl()}/api/store/return?order=${orderId}`,
    cancelUrl,
    collectShipping: product.kind === 'physical',
  });
  if (!session.ok) {
    await query("UPDATE store_orders SET status='failed' WHERE id=$1", [orderId]);
    return res.status(502).type('html').send(page('Checkout error',
      '<h1>Couldn’t start checkout</h1><p>' + esc(session.message || 'The payment processor could not start checkout.') + ' Nothing was charged.</p>'));
  }
  await query('UPDATE store_orders SET stripe_session_id=$1 WHERE id=$2', [session.id, orderId]);
  return res.redirect(303, session.url);
}));

module.exports = router;
