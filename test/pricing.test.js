const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateQuote } = require('../src/services/pricing');

test('full blueprint quote is consistent', () => {
  const quote = calculateQuote({ track: 'A', payment_plan: 'one_time' });
  assert.equal(quote.subtotal, 6000);
  assert.equal(quote.lineItems.length, 1);
  assert.equal(quote.financedTotal, null);
  assert.equal(quote.monthlyMaintenance, 60);
});

test('financing adds three months of maintenance', () => {
  const quote = calculateQuote({ track: 'B', cart: ['marketing_site'], payment_plan: 'financed' });
  assert.equal(quote.subtotal, 1200);
  assert.equal(quote.financedTotal, 1380);
  assert.equal(quote.installmentAmount, 460);
});

test('ai concierge has setup and monthly maintenance', () => {
  const quote = calculateQuote({ track: 'B', cart: ['ai_concierge'], payment_plan: 'financed' });
  assert.equal(quote.subtotal, 500);
  assert.equal(quote.monthlyMaintenance, 125);
  assert.equal(quote.financedTotal, 875);
});

test('empty a la carte submissions are rejected', () => {
  assert.throws(() => calculateQuote({ track: 'B', cart: [], payment_plan: 'one_time' }));
});
