const { test } = require('node:test');
const assert = require('node:assert');
const v = require('../src/services/clay/valuation');

const asset = (type) => ({ type, is_current: true, exclusive_locked: false });

test('a bare idea sits in the lowest tier, floored at $10', () => {
  const r = v.assessValue({ concept: {}, assets: [], waiting: 0 });
  assert.strictEqual(r.tier, 'bare_concept');
  assert.ok(r.range.low_cents >= v.FLOOR_CENTS);
  assert.ok(r.range.high_cents <= 4000);
  assert.deepStrictEqual(r.drivers, ['the shaped idea itself']);
});

test('plan + marketing + build path (instructions) is a full package', () => {
  const r = v.assessValue({ concept: {}, assets: [asset('business_plan'), asset('marketing_strategy'), asset('build_instructions')] });
  assert.strictEqual(r.tier, 'full_package');
  assert.ok(r.has.buildPath && !r.has.launchable);
});

test('a launchable build with plan + marketing is launch-ready and worth the most', () => {
  const r = v.assessValue({ concept: {}, assets: [asset('business_plan'), asset('marketing_strategy'), asset('built_site')] });
  assert.strictEqual(r.tier, 'launch_ready');
  assert.ok(r.has.launchable);
  assert.ok(r.range.high_cents >= 20000);
  assert.ok(r.drivers.includes('a working build a buyer could actually launch'));
});

test('real proof raises the top of the range', () => {
  const base = v.assessValue({ concept: {}, assets: [asset('business_plan'), asset('marketing_strategy'), asset('built_site')], waiting: 0 });
  const proven = v.assessValue({ concept: { research_grounded: true }, assets: [asset('business_plan'), asset('marketing_strategy'), asset('built_site')], waiting: 0 });
  assert.ok(proven.range.high_cents > base.range.high_cents);
  assert.ok(proven.drivers.includes('real proof of demand behind it'));
});

test('waitlist demand counts as proof', () => {
  const r = v.assessValue({ concept: {}, assets: [], waiting: 3 });
  assert.ok(r.has.proof);
});

test('locked (already-sold) assets do not count toward value', () => {
  const r = v.assessValue({ concept: {}, assets: [{ type: 'business_plan', is_current: true, exclusive_locked: true }] });
  assert.strictEqual(r.has.plan, false);
  assert.strictEqual(r.tier, 'bare_concept');
});

test('missing pieces are named as ways to raise value', () => {
  const r = v.assessValue({ concept: {}, assets: [asset('business_plan')] });
  assert.ok(r.toRaise.some((s) => s.includes('marketing')));
  assert.ok(r.toRaise.some((s) => s.includes('proof')));
});
