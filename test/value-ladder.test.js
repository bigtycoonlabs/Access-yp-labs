'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:\/\/|<!--)\s*/g, ' ').replace(/\s+/g, ' ');
const js = fs.readFileSync('public/js/concept.js', 'utf8');
const html = fs.readFileSync('public/concept.html', 'utf8');
const listings = fs.readFileSync(require.resolve('../src/routes/listings.js'), 'utf8');

test('a creator is shown what their project is worth', () => {
  // The valuation was computed on every project and shown to nobody — a complete tier, range and
  // list of what would move it, behind an endpoint no page called. Somebody cannot decide to add
  // another piece if they have never been told what the piece is worth.
  assert.match(html, /id="value-panel"/);
  assert.match(js, /'\/concepts\/' \+ conceptId \+ '\/value'/);
  assert.match(js, /Example range: \$/);
});

test('the number is never presented as a valuation or a promise', () => {
  // A number attached to somebody's hopes is easy to abuse. Most listed projects do not sell.
  // The copy wraps across a JS string concatenation, which no flattening rejoins — match
  // contiguous fragments rather than a sentence that only exists once the code runs.
  assert.match(js, /Not a valuation, not a /);
  assert.match(js, /and not a promise that it sells/);
});

test('what would raise it is named, not left to be inferred', () => {
  // "Add a marketing strategy" is a chore with no visible payoff until you can see what it moves.
  assert.match(js, /What would raise it/);
  assert.match(js, /Ask Clay to do the next one/);
  assert.match(js, /ask=' \+ encodeURIComponent\(v\.to_raise\[0\]\)/);
});

test('a failed valuation never blocks somebody seeing their own work', () => {
  assert.match(js, /renderValue\(project\.id\)\.catch\(function\(\)\{\}\)/);
  assert.match(flat(js), /a project page that shouts about a failed sidebar is worse/i);
});

test('a creator can edit what their listing says', () => {
  // The existing route changes price and stage and touches the listings table only. The words a
  // buyer reads live on the project, so a creator could change their price but not fix a typo in
  // their own title.
  assert.match(listings, /router\.patch\('\/:id\/story'/);
  assert.match(listings, /UPDATE concepts SET title=\$2/);
  assert.match(listings, /AND l\.seller_id = \$2/);
});

test('editing the words is separate from editing the terms', () => {
  // Changing what something costs and changing what it says are different acts, and a buyer
  // watching a listing should be able to tell which happened.
  assert.match(flat(listings), /Separate from the terms route on purpose/i);
});

test('the ladder climbs with every distinct kind of material', () => {
  // The top tier used to end at $800 flat, which said a project with four materials and one with
  // twenty were worth the same the moment both cleared the bar. If adding the eighth piece cannot
  // move the number, nobody adds it.
  const v = require('../src/services/clay/valuation');
  const mk = (types, concept) => v.assessValue({
    concept: concept || {}, assets: types.map((t) => ({ type: t, is_current: true })), waiting: 0 });

  const four = mk(['business_plan', 'marketing_strategy', 'html_demo', 'tech_spec']);
  const eight = mk(['business_plan', 'marketing_strategy', 'html_demo', 'tech_spec',
    'customer_research', 'regulatory_risk', 'money_flow', 'growth_plan']);
  assert.strictEqual(four.tier, 'launch_ready');
  assert.strictEqual(eight.tier, 'launch_ready');
  assert.ok(eight.range.high_cents > four.range.high_cents,
    'more material must move the ceiling within the same tier');
});

test('the top tier has no fixed ceiling', () => {
  const v = require('../src/services/clay/valuation');
  assert.strictEqual(v.TIERS.launch_ready.high, null);
  const deep = v.assessValue({
    concept: {},
    assets: ['business_plan', 'marketing_strategy', 'html_demo', 'tech_spec', 'customer_research',
      'regulatory_risk', 'money_flow', 'growth_plan', 'presell_kit', 'built_site', 'code_file', 'social_kit']
      .map((t) => ({ type: t, is_current: true })),
    waiting: 0 });
  assert.ok(deep.range.high_cents > 80000, 'a deep project passes the old $800 cap');
  assert.strictEqual(deep.depth.uncapped, true);
});

test('the number is called an EXAMPLE, never a recommendation', () => {
  // Recommended, suggested and advised turn a description of what other packages listed at into a
  // number the platform is telling somebody to charge.
  assert.match(js, /Example range: \$/);
  assert.ok(js.includes('recommendation, and not a promise that it sells'));
  assert.ok(!/Asking range|suggested range|recommended price/i.test(js));
  const spine = fs.readFileSync(require.resolve('../src/services/clay/spine.js'), 'utf8');
  assert.ok(spine.includes('Always call it an EXAMPLE'));
  assert.ok(spine.includes('never a recommendation, a suggestion, a valuation or advice'));
});

test('a creator is told the ceiling moves with their work', () => {
  // Somebody who cannot see that the number responds to what they add has no reason to add anything.
  assert.match(js, /Each further kind you add moves the top of that range/);
  assert.match(js, /there is no ceiling on it/);
});
