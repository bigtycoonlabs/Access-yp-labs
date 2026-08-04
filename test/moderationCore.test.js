const { test } = require('node:test');
const assert = require('node:assert');
const mc = require('../src/services/moderationCore');

test('only policy reasons exist; "competes with mine" is not one', () => {
  assert.deepStrictEqual(mc.REASONS, ['missing_baseline', 'running_business', 'fraud', 'missing_risk_disclosure']);
  assert.ok(!mc.REASONS.includes('competes_with_mine'));
});

test('decideListing rejects a bad decision before touching the database', async () => {
  const r = await mc.decideListing({ id: 'u1', role: 'staff' }, 'L1', { decision: 'maybe' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.http, 400);
});

test('rejecting a listing requires a valid policy reason', async () => {
  const r = await mc.decideListing({ id: 'u1', role: 'staff' }, 'L1', { decision: 'rejected' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /policy reason/i);
});
