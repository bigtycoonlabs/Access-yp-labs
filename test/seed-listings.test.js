'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const pres = fs.readFileSync(require.resolve('../src/services/clay/seedPresentation.js'), 'utf8');
const presentation = require('../src/services/clay/seedPresentation');

test('a generated demo can never contain a payment form', () => {
  // Instructions are requests; this is the guarantee. We sell the project, not a shop that takes
  // money for a business nobody is running.
  assert.match(pres, /payment_ui_present/);
  assert.match(pres, /type=\["'\]\?\(card\|cc-number\)\|stripe\|checkout/);
  assert.match(flat(pres), /DELIBERATELY NO PAYMENT INTEGRATION/i);
});

test('the demo must be usable without sight', () => {
  // A demo a blind creator cannot operate is not a demo.
  assert.match(pres, /keyboard operable/i);
  assert.match(pres, /screen reader/i);
  assert.match(pres, /visible focus/i);
});

test('the landing page is written only from what the project says', () => {
  assert.match(pres, /Never state a revenue figure/);
  assert.match(pres, /Never imply the business is already operating/);
});

test('a prototype is only built where it represents the business', () => {
  // Generating a fake app for a cleaning round would misrepresent it.
  assert.strictEqual(presentation.wantsDemo('digital_product_saas', ['business_plan']), true);
  assert.strictEqual(presentation.wantsDemo('remote_hybrid_physical', ['business_plan']), false);
  assert.strictEqual(presentation.wantsDemo('micro_solo', ['tech_spec']), true);
});

test('presentation never breaks a seed', () => {
  // A seed that produced good materials must not fail because a headline could not be written.
  const fn = pres.slice(pres.indexOf('async function enrich'));
  assert.match(fn, /catch \(e\)/);
  const seed = fs.readFileSync(require.resolve('../src/services/clay/seed.js'), 'utf8');
  assert.match(seed, /seed presentation failed \(seed is unaffected\)/);
});

test('the presentation builder uses the real provider interface', () => {
  // It was written against a complete(prompt, opts) signature that does not exist; the provider
  // takes { system, user, json }. Caught by calling it rather than by reading it.
  assert.match(pres, /provider\.complete\(\{ system, user, json: true/);
  assert.match(pres, /!out\.ok/);
});
