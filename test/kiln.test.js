const { test } = require('node:test');
const assert = require('node:assert');
const money = require('../src/lib/money');
const { classifySection, assessCoverage } = require('../src/services/clay/interpreter');

test('platform take is 20%', () => {
  assert.strictEqual(money.platformFeeCents(10000), 2000);
  assert.strictEqual(money.sellerNetCents(10000), 8000);
});

test('$50 price floor is enforced', () => {
  assert.strictEqual(money.isAboveFloor(5000), true);
  assert.strictEqual(money.isAboveFloor(4999), false);
  assert.strictEqual(money.isAboveFloor(50.5), false);
});

test('consultant split is $150 -> $30 / $120', () => {
  assert.strictEqual(money.CONSULT_FEE_CENTS, 15000);
  assert.strictEqual(money.CONSULT_PLATFORM_CENTS + money.CONSULT_CONSULTANT_CENTS, money.CONSULT_FEE_CENTS);
  assert.strictEqual(money.CONSULT_CONSULTANT_CENTS, 12000);
});

test('subscription prices', () => {
  assert.strictEqual(money.SUB_PER_IDEA_CENTS, 299);
  assert.strictEqual(money.SUB_UNLIMITED_CENTS, 4999);
});

test('interpreter classifies honestly', () => {
  assert.strictEqual(classifySection('A real, substantive business plan section.'), 'answered');
  assert.strictEqual(classifySection(''), 'empty');
  assert.strictEqual(classifySection(null), 'empty');
  assert.strictEqual(classifySection('Unable to determine competitor pricing.'), 'unavailable');
});

test('coverage reports gaps truthfully', () => {
  const cov = assessCoverage({ business_plan: 'ok', marketing_strategy: '' });
  assert.strictEqual(cov.complete, false);
  assert.deepStrictEqual(cov.present, ['business_plan']);
  assert.deepStrictEqual(cov.missing, ['marketing_strategy']);
});
