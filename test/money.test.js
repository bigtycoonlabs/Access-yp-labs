const { test } = require('node:test');
const assert = require('node:assert');
const {
  platformFeeCents, sellerNetCents,
  moverCommissionCents, platformNetAfterMoverCents, MOVER_RATE,
} = require('../src/lib/money');

test('platform fee is 20% and the seller nets 80%', () => {
  assert.strictEqual(platformFeeCents(32500), 6500);   // 20% of $325
  assert.strictEqual(sellerNetCents(32500), 26000);    // 80% of $325
});

test('Affiliate commission is 5% of the sale', () => {
  assert.strictEqual(MOVER_RATE, 0.05);
  assert.strictEqual(moverCommissionCents(32500), 1625); // 5% of $325 = $16.25
});

test('the mover is paid out of the platform take — the seller is never touched', () => {
  const amount = 32500;
  // Seller's share is identical whether or not a mover was involved.
  assert.strictEqual(sellerNetCents(amount), 26000);
  // Platform net falls from 20% to 15% when a mover is attributed.
  assert.strictEqual(
    platformNetAfterMoverCents(amount),
    platformFeeCents(amount) - moverCommissionCents(amount));
  assert.strictEqual(platformNetAfterMoverCents(amount), 4875); // 15% of $325
  // Seller + mover + platform reconcile exactly to the whole sale, no leftover cents.
  assert.strictEqual(
    sellerNetCents(amount) + moverCommissionCents(amount) + platformNetAfterMoverCents(amount),
    amount);
});

test('shares reconcile at the $10 floor', () => {
  const amount = 1000;
  assert.strictEqual(moverCommissionCents(amount), 50);        // $0.50
  assert.strictEqual(platformFeeCents(amount), 200);           // $2.00
  assert.strictEqual(platformNetAfterMoverCents(amount), 150); // $1.50
  assert.strictEqual(
    sellerNetCents(amount) + moverCommissionCents(amount) + platformNetAfterMoverCents(amount),
    amount);
});
