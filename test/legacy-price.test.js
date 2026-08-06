'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const money = require('../src/lib/money');
const fs = require('fs');
const webhooks = fs.readFileSync(require.resolve('../src/routes/webhooks.js'), 'utf8');
const subs = fs.readFileSync(require.resolve('../src/routes/subscriptions.js'), 'utf8');

test('a retired plan can be RECORDED but never SOLD', () => {
  // Two different questions: "what may we charge for this?" and "what does this person already pay?"
  assert.strictEqual(money.planCents('maker'), null, 'not sellable');
  assert.strictEqual(money.planCents('sculptor'), null, 'not sellable');
  assert.strictEqual(money.recordedPlanCents('maker'), 299, 'but recordable at its real price');
  assert.strictEqual(money.recordedPlanCents('sculptor'), 4999);
  assert.strictEqual(money.recordedPlanCents('builder'), 1900);
});

test('the webhook records, and checkout sells', () => {
  // Getting these the wrong way round either resells a retired price or breaks a live subscriber.
  assert.match(webhooks, /const price = recordedPlanCents\(md\.plan\)/);
  assert.match(subs, /priceCents: planCents\(plan\)/);
});

test('an unknown plan records as zero rather than null', () => {
  // price_cents is NOT NULL. Returning null here meant a failed insert, a 500, and Stripe retrying
  // forever while the subscription never registered.
  assert.strictEqual(money.recordedPlanCents('nonsense'), 0);
});
