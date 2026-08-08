'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const stripeSrc = fs.readFileSync(require.resolve('../src/services/stripe.js'), 'utf8');
const orders = fs.readFileSync(require.resolve('../src/routes/orders.js'), 'utf8');
const stripe = require('../src/services/stripe');

test('a refund is actually possible', () => {
  // The code told buyers "your payment will be refunded" while the Stripe service had no refund
  // function and the order carried no payment reference. A promise with nothing behind it.
  assert.strictEqual(typeof stripe.refundPayment, 'function');
  assert.match(stripeSrc, /refunds\.create\(\{ payment_intent: intent, reason \}\)/);
});

test('the refund reports failure rather than throwing', async () => {
  // Same contract as everything else here — a refund that silently failed would be the worst
  // possible version of this function.
  const r = await stripe.refundPayment({});
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason, 'a reason is always given');
});

test('the payment reference is stored when the payment is created', () => {
  // Reconstructing it from Stripe later by matching amounts and timestamps is guesswork with
  // somebody's money.
  assert.match(orders, /UPDATE orders_transfers SET stripe_session_id=\$2 WHERE id=\$1/);
  assert.match(flat(orders), /Without it a refund is impossible/i);
});

test('the double-sale message says what ACTUALLY happened', () => {
  // Not a blanket promise. Either it was refunded, or a person has been flagged — and the buyer is
  // told which, plus that they do not need to chase it.
  assert.match(orders, /Your payment has been refunded/);
  assert.match(orders, /could not process your refund automatically/);
  assert.match(orders, /you do not need to chase it/);
  assert.match(orders, /refunded_at=\$2, refund_reason=\$3/);
});
