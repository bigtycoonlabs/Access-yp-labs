const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const v = require('../src/services/clay/valuation');

const asset = (type) => ({ type, is_current: true, exclusive_locked: false });

test('a bare idea sits in the lowest tier, floored at $10', () => {
  const r = v.assessValue({ concept: {}, assets: [], waiting: 0 });
  assert.strictEqual(r.tier, 'bare_concept');
  assert.ok(r.range.low_cents >= v.FLOOR_CENTS);
  // The tier ceiling, not a hardcoded figure: the whole table was repriced from $40 to $500 at this
  // tier to match what pre-revenue projects actually change hands for, and pinning the number rather
  // than the property is what made this test fail for the right change.
  assert.ok(r.range.high_cents <= v.TIERS.bare_concept.high);
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


// THE LADDER HAS TO REACH WHAT THIS MARKET PAYS.
//
// It used to top out at $250 for a full package, about $610 once depth was counted. That was priced
// for the marketplace as it is today — 12 live listings, $45 to $325, averaging $138 — not for what
// is being sold. A seller with a researched package and a working build could not ask for what
// comparable projects fetch.
//
// Published 2026 comparables for pre-revenue projects: an idea plus a domain $0–$500; a working
// product with no users $500–$3,000; a product with a waitlist or early users $2,000–$10,000; strong
// assets $5,000–$25,000+. One marketplace in this niche averages about $4,300 a deal.

test('the ladder spans the whole market, not just the bottom of it', () => {
  const a = (t) => ({ type: t, is_current: true });
  const real = ['business_plan', 'marketing_strategy', 'tech_spec', 'customer_research',
    'competitor_research', 'regulatory_risk', 'ops_plan', 'gtm_plan', 'money_flow', 'build_path',
    'presell_kit'].map(a);

  const paper = v.assessValue({ concept: {}, assets: real, waiting: 0 });
  assert.strictEqual(paper.tier, 'full_package');
  assert.ok(paper.range.high_cents >= 300000, 'a full researched package must reach the thousands');

  const built = v.assessValue({ concept: {}, assets: [...real, a('built_site')], waiting: 4 });
  assert.strictEqual(built.tier, 'launch_ready');
  assert.ok(built.range.high_cents >= 1000000, 'a launch-ready project with demand must reach five figures');
  assert.ok(built.range.low_cents >= 100000, 'and must not start in the hundreds');
});

test('paper never outprices a working build', () => {
  // Without this a thoroughly researched package could be quoted above a project with a site
  // somebody could launch on Monday. No buyer of these thinks that way: they are asking what it
  // costs to run this without the person who built it, and paper leaves more of that cost with them.
  const a = (t) => ({ type: t, is_current: true });
  const everything = ['business_plan', 'marketing_strategy', 'tech_spec', 'customer_research',
    'competitor_research', 'regulatory_risk', 'ops_plan', 'gtm_plan', 'money_flow', 'build_path',
    'presell_kit', 'brand_kit', 'faq'].map(a);
  const paper = v.assessValue({ concept: {}, assets: everything, waiting: 50 });
  const launchable = v.assessValue({ concept: {}, assets: [a('built_site'), a('business_plan'), a('marketing_strategy')], waiting: 0 });
  assert.ok(!paper.has.launchable);
  assert.ok(paper.range.high_cents <= launchable.range.low_cents * 4,
    'no amount of paper may pass the base of launch-ready');
});

test('real demand lifts the floor as well as the ceiling', () => {
  // The comparables roughly double when a waitlist appears: $500–$3,000 becomes $2,000–$10,000. The
  // old multiplier moved only the ceiling, which left a project people are already waiting for
  // starting at the same floor as one nobody has heard of.
  const a = (t) => ({ type: t, is_current: true });
  const pack = () => [a('built_site'), a('business_plan'), a('marketing_strategy')];
  const cold = v.assessValue({ concept: {}, assets: pack(), waiting: 0 });
  const wanted = v.assessValue({ concept: {}, assets: pack(), waiting: 6 });
  assert.ok(wanted.range.low_cents > cold.range.low_cents, 'the floor moves');
  assert.ok(wanted.range.high_cents > cold.range.high_cents, 'and so does the ceiling');
});

test('the floor is still the $10 listing minimum, and it is still an example', () => {
  const r = v.assessValue({ concept: {}, assets: [], waiting: 0 });
  assert.ok(r.range.low_cents >= v.FLOOR_CENTS);
  // None of this repricing makes it a valuation. The word stays "example" everywhere.
  const src = fs.readFileSync('src/services/clay/valuation.js', 'utf8');
  assert.ok(!/\brecommended\b|\bsuggested\b|\badvised\b/i.test(src.replace(/\/\/.*$/gm, '')));
});
