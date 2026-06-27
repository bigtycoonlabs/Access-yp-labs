const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateQuote } = require('../src/services/pricing');

test('arbitrage access quote is consistent', () => {
  const quote = calculateQuote({ track: 'A', payment_plan: 'one_time' });
  assert.equal(quote.subtotal, 997);
  assert.equal(quote.lineItems.length, 1);
  assert.equal(quote.lineItems[0].type, 'arbitrage_access');
  assert.equal(quote.financedTotal, null);
});

test('financing is rejected for the single access price', () => {
  assert.throws(() => calculateQuote({ track: 'A', payment_plan: 'financed' }));
});

test('cart contents cannot alter the unified quote', () => {
  const quote = calculateQuote({ track: 'A', cart: ['sop_manual', 'not-real'], payment_plan: 'one_time' });
  assert.equal(quote.subtotal, 997);
  assert.equal(quote.lineItems.length, 1);
});

test('old split tracks are rejected', () => {
  assert.throws(() => calculateQuote({ track: 'B', cart: [], payment_plan: 'one_time' }));
});
