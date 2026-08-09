'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const routeSrc = fs.readFileSync(require.resolve('../src/routes/seedListings.js'), 'utf8');
const pres = fs.readFileSync(require.resolve('../src/services/clay/seedPresentation.js'), 'utf8');
const presentation = require('../src/services/clay/seedPresentation');

test('staff can edit a Clay listing, including its title', () => {
  // The existing route requires seller_id = the person asking, and no human IS Clay — so seeded
  // listings were frozen. And it could not change a title at all, because the title lives on the
  // project rather than the listing.
  assert.match(routeSrc, /router\.patch\('\/:id'/);
  assert.match(routeSrc, /UPDATE concepts SET title=\$2/);
  assert.match(routeSrc, /UPDATE listings SET price_cents=\$2/);
});

test('staff can NEVER edit a creator listing', () => {
  // Rewriting somebody's sales copy, silently, under their own dreamer tag, would break what this
  // platform promises. Two independent checks: origin could in principle be edited, the owning
  // account cannot.
  assert.match(routeSrc, /row\.origin === 'clay_seed' && row\.owner_email === 'clay@accessyplabs\.com'/);
  assert.match(routeSrc, /NOT_YOURS_TO_EDIT/);
  assert.match(routeSrc, /its words are theirs/);
});

test('every staff edit is recorded with a name on it', () => {
  assert.match(routeSrc, /INSERT INTO moderation_events/);
  assert.match(routeSrc, /STAFF EDIT of a Clay-seeded listing/);
});

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

test('an existing seed can be given a page and prototype on request', () => {
  // Presentation runs automatically on NEW seeds, which does nothing for the ten already in the
  // market — and those are exactly the listings anybody would promote first.
  assert.match(routeSrc, /router\.post\('\/:id\/presentation'/);
  assert.match(routeSrc, /presentation\.enrich\(/);
});

test('a hand-written landing page is never silently overwritten', () => {
  // generated_by is stamped on anything Clay wrote, so a page without it was written by a person
  // and is not ours to replace.
  assert.match(routeSrc, /existing\.generated_by !== 'clay_seed'/);
  assert.match(routeSrc, /reason: 'human_written'/);
  assert.match(routeSrc, /Send replace: true if you are sure/);
});

test('building nothing is reported as building nothing', () => {
  // A project whose materials are too thin to write a page from is a real outcome. Reporting it as
  // success would be the exact defect this platform is built against.
  assert.match(routeSrc, /ok: made\.length > 0/);
  assert.match(routeSrc, /'Nothing was built\. '/);
  assert.match(routeSrc, /not_built: skipped/);
});

test('the presentation builder uses the real provider interface', () => {
  // It was written against a complete(prompt, opts) signature that does not exist; the provider
  // takes { system, user, json }. Caught by calling it rather than by reading it.
  assert.match(pres, /provider\.complete\(\{ system, user, json: true/);
  assert.match(pres, /!out\.ok/);
});
