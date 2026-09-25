'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const ent = require('../src/lib/entitlement');
const entSrc = fs.readFileSync(require.resolve('../src/lib/entitlement.js'), 'utf8');

test('an owner reads ALL of their own materials while building', () => {
  // Ten of fourteen materials used to be hidden on any project past a creator's first, WHILE THEY
  // WERE STILL BUILDING — which contradicts "building is free and unlimited".
  const a = [{ type: 'business_plan', body: 'x' }, { type: 'money_flow', body: 'y' },
    { type: 'tech_spec', body: 'z' }, { type: 'regulatory_risk', body: 'w' }];
  assert.strictEqual(ent.ownerAssets(a).filter((x) => x.body).length, 4);
  assert.match(flat(entSrc), /AN OWNER ALWAYS READS THEIR OWN WORK/i);
});

test('a NON-owner is still redacted', () => {
  // Staff reading something in review must not get the full contents.
  const a = [{ type: 'business_plan', body: 'x' }, { type: 'money_flow', body: 'y' }];
  assert.strictEqual(ent.redactLockedAssets(a, false).filter((x) => !x.body).length, 1);
});

test('the database accepts the plan we actually sell', () => {
  // The constraint allowed only 'maker' and 'sculptor', both retired. The first real subscriber
  // would have been charged by Stripe and then the webhook insert would have thrown.
  // The comment wraps across lines, so flatten before matching a sentence.
  const mig = flat(fs.readFileSync('docs/migrations/049_allow_builder_plan.sql', 'utf8'));
  assert.match(mig, /'builder'::text/);
  assert.match(mig, /charged by Stripe and then the webhook insert would have thrown/i);
});
