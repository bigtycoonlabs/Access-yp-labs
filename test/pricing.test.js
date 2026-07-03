const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateQuote } = require('../src/services/pricing');

test('full blueprint quote is consistent', () => {
  const quote = calculateQuote({ track: 'A', payment_plan: 'one_time' });
  assert.equal(quote.subtotal, 6000);
  assert.equal(quote.lineItems.length, 1);
  assert.equal(quote.financedTotal, null);
});

test('financing adds three months of hosting', () => {
  const quote = calculateQuote({ track: 'B', cart: ['marketing_site'], payment_plan: 'financed' });
  assert.equal(quote.subtotal, 1200);
  assert.equal(quote.financedTotal, 1380);
  assert.equal(quote.installmentAmount, 460);
});

test('duplicate and unknown services cannot alter a quote', () => {
  const quote = calculateQuote({ track: 'B', cart: ['sop_manual', 'sop_manual', 'not-real'], payment_plan: 'one_time' });
  assert.equal(quote.subtotal, 750);
  assert.equal(quote.lineItems.length, 1);
});

test('empty a la carte submissions are rejected', () => {
  assert.throws(() => calculateQuote({ track: 'B', cart: [], payment_plan: 'one_time' }));
});
