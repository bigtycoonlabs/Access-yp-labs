'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const webhooks = fs.readFileSync(require.resolve('../src/routes/webhooks.js'), 'utf8');
const orders = fs.readFileSync(require.resolve('../src/routes/orders.js'), 'utf8');

test('a payment event handled but not recorded reaches a person', () => {
  // The event succeeded but was not written to the de-duplication table, so Stripe's retry runs the
  // whole handler again — recording a subscription twice, or moving an order into escrow twice, for
  // one real payment. Nothing downstream notices, because each run looks correct on its own.
  assert.match(webhooks, /kind: 'webhook_not_recorded'/);
  assert.match(webhooks, /may be processed twice/i);
  assert.match(flat(webhooks), /WORSE THAN IT LOOKS/i);
});

test('an unreadable de-duplication table is reported, not assumed away', () => {
  assert.match(webhooks, /kind: 'webhook_dedupe_unavailable'/);
  assert.match(webhooks, /refusing would drop a real payment/i);
});

test('a seller still being billed for a project they sold is reported', () => {
  // "Logged for follow-up" is only true if somebody is actually told. The person affected would
  // keep paying monthly for a project they no longer own, with no way to notice but their statement.
  assert.match(orders, /kind: 'seller_billing_not_stopped'/);
  assert.match(orders, /still being billed for a project they sold/i);
  assert.match(flat(orders), /A console line in a server log is not follow-up/i);
});

test('none of these undo the sale itself', () => {
  // A Stripe hiccup must never roll back a completed, paid transfer — the buyer owns it.
  assert.match(orders, /The sale itself completed correctly and the buyer owns the project/i);
  assert.match(webhooks, /Nothing is wrong with the payment itself/i);
});
