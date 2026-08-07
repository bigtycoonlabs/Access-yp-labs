'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const ent = require('../src/lib/entitlement');
const entSrc = fs.readFileSync(require.resolve('../src/lib/entitlement.js'), 'utf8');
const concepts = fs.readFileSync(require.resolve('../src/routes/concepts.js'), 'utf8');

test('an owner reads ALL of their own materials while building', () => {
  // Ten of fourteen materials used to be hidden on any project past a creator's first, WHILE THEY
  // WERE STILL BUILDING — which contradicts "building is free and unlimited".
  const a = [{ type: 'business_plan', body: 'x' }, { type: 'money_flow', body: 'y' },
    { type: 'tech_spec', body: 'z' }, { type: 'regulatory_risk', body: 'w' }];
  assert.strictEqual(ent.ownerAssets(a).filter((x) => x.body).length, 4);
  assert.match(concepts, /assets: ownerAssets\(a\.rows\)/);
  assert.match(flat(entSrc), /AN OWNER ALWAYS READS THEIR OWN WORK/i);
});

test('a NON-owner is still redacted', () => {
  // Staff reading something in review must not get the full contents.
  const a = [{ type: 'business_plan', body: 'x' }, { type: 'money_flow', body: 'y' }];
  assert.strictEqual(ent.redactLockedAssets(a, false).filter((x) => !x.body).length, 1);
});

test('what LEAVES the platform is still gated', () => {
  // The plan gates export, publishing a site, and taking payments — not reading your own work.
  assert.match(concepts, /GATED export/);
  assert.match(concepts, /return res\.status\(402\)\.json\(paywall/);
});

test('the database accepts the plan we actually sell', () => {
  // The constraint allowed only 'maker' and 'sculptor', both retired. The first real subscriber
  // would have been charged by Stripe and then the webhook insert would have thrown.
  // The comment wraps across lines, so flatten before matching a sentence.
  const mig = flat(fs.readFileSync('docs/migrations/049_allow_builder_plan.sql', 'utf8'));
  assert.match(mig, /'builder'::text/);
  assert.match(mig, /charged by Stripe and then the webhook insert would have thrown/i);
});

test('retired offers are gone from every live surface', () => {
  const dash = fs.readFileSync('public/js/dashboard.js', 'utf8');
  const dashHtml = fs.readFileSync('public/dashboard.html', 'utf8');
  assert.ok(!/loadEngagements\(\)/.test(dash), 'no consultant loader');
  assert.ok(!/Consultant sessions/.test(dashHtml), 'no consultant section');
  assert.match(fs.readFileSync('public/admin-consultants.html', 'utf8'), /retired/i);
  // And the markup and the code agree — removing one without the other is how a page throws.
  assert.ok(!/getElementById\('engagements'\)/.test(dash));
});
