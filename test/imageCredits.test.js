const { test } = require('node:test');
const assert = require('node:assert');
const ic = require('../src/lib/imageCredits');

test('the image allowance is per ACCOUNT per month, not per project', () => {
  // Per-project multiplied by unlimited projects was unbounded: a heavy user on the top plan could
  // cost more in generation than they paid. These numbers are generous for a real person and finite
  // for us, which is the whole point of the change.
  // Free 5, Desk 60, Office 150 (owner, 16 Sept 2026). Retired plans keep the 60 they were sold with.
  assert.strictEqual(ic.monthlyIncluded('base'), 5);
  assert.strictEqual(ic.monthlyIncluded('desk'), 60);
  assert.strictEqual(ic.monthlyIncluded('office'), 150);
  assert.strictEqual(ic.monthlyIncluded('builder'), 60);
  assert.strictEqual(ic.monthlyIncluded('sculptor'), 60);
  assert.strictEqual(ic.monthlyIncluded(undefined), 5);     // default to the free allowance
});

test('Extras packs are 20 for $0.99 and 50 for $1.65', () => {
  assert.deepStrictEqual(
    ic.packById('img20') && { images: ic.packById('img20').images, price: ic.packById('img20').price_cents },
    { images: 20, price: 99 });
  assert.deepStrictEqual(
    ic.packById('img50') && { images: ic.packById('img50').images, price: ic.packById('img50').price_cents },
    { images: 50, price: 165 });
  assert.strictEqual(ic.packById('nope'), null);
});

test('budget: within allowance, free remaining counts down', () => {
  const b = ic.budget({ plan: 'base', usedThisMonth: 2, purchased: 0 });
  assert.strictEqual(b.free_remaining, 3);
  assert.strictEqual(b.total_remaining, 3);
  assert.strictEqual(b.can_generate, true);
});

test('budget: allowance exhausted with no packs means no generation', () => {
  const b = ic.budget({ plan: 'base', usedThisMonth: 5, purchased: 0 });
  assert.strictEqual(b.free_remaining, 0);
  assert.strictEqual(b.total_remaining, 0);
  assert.strictEqual(b.can_generate, false);
});

test('budget: past the allowance, purchased pack credits carry it', () => {
  const b = ic.budget({ plan: 'base', usedThisMonth: 15, purchased: 10 });
  assert.strictEqual(b.free_remaining, 0);       // used beyond included -> no free left
  assert.strictEqual(b.purchased_balance, 10);
  assert.strictEqual(b.total_remaining, 10);
  assert.strictEqual(b.can_generate, true);
});

test('budget: the plan gets the larger monthly allowance', () => {
  const b = ic.budget({ plan: 'builder', usedThisMonth: 20, purchased: 0 });
  assert.strictEqual(b.free_remaining, 40);
  assert.strictEqual(b.total_remaining, 40);
});

test('autoBudget: sparing — a couple on first build, capped by what remains, none on enhancements', () => {
  assert.strictEqual(ic.autoBudget({ plan: 'base', usedThisMonth: 0, purchased: 0, isFirstBuild: true }), 2);
  assert.strictEqual(ic.autoBudget({ plan: 'base', usedThisMonth: 4, purchased: 0, isFirstBuild: true }), 1);
  assert.strictEqual(ic.autoBudget({ plan: 'base', usedThisMonth: 5, purchased: 0, isFirstBuild: true }), 0);
  assert.strictEqual(ic.autoBudget({ plan: 'base', usedThisMonth: 0, purchased: 0, isFirstBuild: false }), 0);
});
