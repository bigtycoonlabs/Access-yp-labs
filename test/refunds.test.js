'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const stripeSrc = fs.readFileSync(require.resolve('../src/services/stripe.js'), 'utf8');
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
