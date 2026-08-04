const { test } = require('node:test');
const assert = require('node:assert');
const m = require('../src/services/clay/movement');

test('three lanes, in order, earliest first', () => {
  assert.deepStrictEqual(m.LANES, ['needs_customer_clarity', 'needs_proof', 'ready_to_package']);
  assert.strictEqual(m.DEFAULT_LANE, 'needs_customer_clarity');
});

test('isLane accepts only the three lanes', () => {
  assert.strictEqual(m.isLane('needs_customer_clarity'), true);
  assert.strictEqual(m.isLane('needs_proof'), true);
  assert.strictEqual(m.isLane('ready_to_package'), true);
  assert.strictEqual(m.isLane('bogus'), false);
  assert.strictEqual(m.isLane(''), false);
  assert.strictEqual(m.isLane(undefined), false);
});

test('describe returns full copy and falls back to the default lane', () => {
  for (const lane of m.LANES) {
    const d = m.describe(lane);
    assert.ok(d.label && d.meaning && d.moves, 'lane ' + lane + ' has full copy');
  }
  assert.strictEqual(m.describe('bogus').label, m.DETAIL[m.DEFAULT_LANE].label);
  assert.strictEqual(m.label('ready_to_package'), 'Ready to package');
});
