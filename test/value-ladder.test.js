'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

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

test('Clay is told to call the number an EXAMPLE, never a recommendation', () => {
  // Recommended, suggested and advised turn a description of what other packages listed at into a
  // number the platform is telling somebody to charge.
  const spine = fs.readFileSync(require.resolve('../src/services/clay/spine.js'), 'utf8');
  assert.ok(spine.includes('Always call it an EXAMPLE'));
  assert.ok(spine.includes('never a recommendation, a suggestion, a valuation or advice'));
});
