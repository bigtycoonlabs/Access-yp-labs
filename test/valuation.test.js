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
  const pack = () => [asset('business_plan'), asset('marketing_strategy'), asset('built_site')];
  const base = v.assessValue({ concept: {}, assets: pack(), waiting: 0 });
  // Behaviour: somebody outside the building actually did something.
  const proven = v.assessValue({ concept: {}, assets: pack(), waiting: 3 });
  assert.ok(proven.range.high_cents > base.range.high_cents);
  assert.ok(proven.drivers.includes('real proof of demand behind it'));
});

test('desk research is not proof of demand, and does not raise the price', () => {
  // This test used to assert the opposite, using research_grounded as its example of "real proof".
  // research_grounded means CLAY searched the web and checked his claims against sources. Good work,
  // and not evidence that anybody wants the thing. It was raising the ceiling by 35% on the strength
  // of a web search — nothing the creator did, nothing a stranger did.
  //
  // Found by walking a real build end to end: the project came back with movement_state
  // 'needs_customer_clarity' — Clay's own honest read that no customer had been identified — while
  // the value panel on the SAME project said "real proof of demand behind it" and quoted a higher
  // range. Two statements from the same platform contradicting each other, with a price on the
  // wrong one. And flatly against the doctrine Clay is given: proof is behaviour, not compliments,
  // and a project is never strong because it reads polished. A researched package reads polished.
  const pack = () => [asset('business_plan'), asset('marketing_strategy'), asset('built_site')];
  const base = v.assessValue({ concept: {}, assets: pack(), waiting: 0 });
  for (const concept of [{ research_grounded: true }, { claims_verified: true },
    { research_grounded: true, claims_verified: true }]) {
    const r = v.assessValue({ concept, assets: pack(), waiting: 0 });
    assert.strictEqual(r.has.proof, false, JSON.stringify(concept) + ' must not count as proof');
    assert.strictEqual(r.range.high_cents, base.range.high_cents, 'and must not move the price');
    assert.ok(!r.drivers.includes('real proof of demand behind it'));
    // It should still be told what WOULD count, rather than left with nothing to do.
    assert.ok(r.toRaise.some((t) => /proof of demand/.test(t)));
  }
});

test('the value panel never contradicts the honest read on the same project', () => {
  // A project Clay has placed at needs_customer_clarity or needs_proof has, by his own assessment,
  // no proof of demand. The panel must not say otherwise on the same screen.
  for (const state of ['needs_customer_clarity', 'needs_proof']) {
    const r = v.assessValue({
      concept: { movement_state: state, research_grounded: true, claims_verified: true },
      assets: [asset('business_plan'), asset('marketing_strategy'), asset('built_site')],
      waiting: 0,
    });
    assert.strictEqual(r.has.proof, false, state + ' cannot show as proven');
  }
  // And where he HAS placed it from real behaviour, it counts.
  const ready = v.assessValue({ concept: { movement_state: 'ready_to_package' }, assets: [], waiting: 0 });
  assert.strictEqual(ready.has.proof, true);
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
