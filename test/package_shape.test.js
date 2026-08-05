'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { ASSET_PLAN } = require('../src/services/clay/tools');

const types = () => ASSET_PLAN.map((a) => a.type);

test('default package is foundation-only — the demo is opt-in, not bundled', () => {
  assert.ok(!types().includes('html_demo'), 'html_demo must not be in the default plan');
});

test('technical guidance is consolidated into one tech_spec', () => {
  assert.ok(types().includes('tech_spec'), 'tech_spec present');
  assert.ok(!types().includes('website_prompt'), 'website_prompt folded into tech_spec');
  assert.ok(!types().includes('tech_requirements'), 'tech_requirements folded into tech_spec');
  assert.ok(!types().includes('build_instructions'), 'build_instructions folded into tech_spec');
});

test('the foundation assets all remain', () => {
  const t = types();
  for (const k of ['business_plan', 'marketing_strategy', 'customer_research', 'competitor_research',
    'regulatory_risk', 'operations_staffing', 'money_flow', 'growth_plan', 'presell_kit', 'example_image']) {
    assert.ok(t.includes(k), 'foundation still has ' + k);
  }
});
