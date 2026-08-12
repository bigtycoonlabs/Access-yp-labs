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
  // Rewriting somebody's sales copy, silently, under their own display name, would break what this
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

test('a refusal to save says what it compared', () => {
  // "Nothing was different" is true but useless: it does not say WHAT was compared, so somebody who
  // just typed a new title cannot tell whether the box was not read, the request never arrived, or
  // the value genuinely matched. For a screen reader user that is the difference between "it
  // ignored me" and "it saw the same words I did".
  assert.match(routeSrc, /you sent "\$\{req\.body\.title\}", stored is/);
  // Both sides of the price, still. Pinned to the property rather than to the arithmetic: the
  // formatting moved into src/lib/price.js when it turned out `(l.price_cents / 100)` printed
  // "$NaN" for an auction, which has a starting bid and no price. What must not regress is that
  // the message reports what was sent AND what is stored.
  assert.match(routeSrc, /you sent \$\{dollars\(req\.body\.price_cents\)\}, stored is \$\{priceLabel\(l\)\}/);
  assert.match(routeSrc, /no fields were sent at all/);
});

test('an empty or non-numeric price never leaves the page', () => {
  // An empty price box sends 0 and a non-numeric one sends NaN, and both came back as a validation
  // error that read like the TITLE was wrong. The editor now lives on the review screen.
  const page = fs.readFileSync('public/market-control.html', 'utf8');
  assert.ok(page.includes("raw==='' || !isFinite(Number(raw))"));
  assert.match(page, /Put a number in the price box/);
  assert.match(page, /The lowest a listing can be is \$10/);
});

test('the fields are named for what they actually do', () => {
  // risk_summary renders as "Risk noted:" — it is not the summary a buyer reads, and labelling it
  // as one meant editing it changed something the person editing never saw change. What a buyer
  // reads is the brief.
  const page = fs.readFileSync('public/market-control.html', 'utf8');
  assert.ok(page.includes('Risk note (shown as "Risk noted")'));
  assert.ok(page.includes('What a buyer reads'));
  assert.ok(page.includes('The problem it solves'));
  assert.ok(!/Summary a buyer reads/.test(page), 'the mislabel is gone');
});

test('staff can see and edit the landing page Clay wrote', () => {
  // A landing page is only ever SERVED by hostname, and web addresses are not switched on — so Clay
  // could report building one and nobody could ever look at it.
  assert.match(routeSrc, /router\.get\('\/:id\/page'/);
  assert.match(routeSrc, /router\.patch\('\/:id\/page'/);
  assert.match(flat(routeSrc), /with no way to see it is exactly the kind of claim this platform is supposed not to make/i);
});

test('editing a page marks it as no longer Clay\'s', () => {
  // So the rebuild button asks before replacing somebody's words instead of overwriting them.
  assert.match(routeSrc, /page\.generated_by = 'edited_by_staff'/);
});
