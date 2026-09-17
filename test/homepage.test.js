'use strict';
// THE FRONT DOOR.
//
// The homepage was still the retired marketplace: "Meet Clay, your partner", "The Exchange", "Get
// Clay Weekly". Every page in the signup funnel — homepage, register, login — advertised a product
// being shut down.
//
// Walked on a 390x780 phone with no account: picked Ohio, pressed Show me, and read what came back.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const home = fs.readFileSync('public/index.html', 'utf8');
const reg = fs.readFileSync('public/register.html', 'utf8');
const preview = fs.readFileSync('src/routes/public-preview.js', 'utf8');
const server = fs.readFileSync('src/server.js', 'utf8');

test('the funnel no longer advertises the retired product', () => {
  // clay-dark is a CSS variable from the old stylesheet and is not user-facing; the prose is what
  // matters. Verified in the rendered page: no "Clay", no "Exchange", no "concept".
  for (const [name, s] of [['index', home], ['register', reg]]) {
    assert.ok(!/Meet Clay|Clay Weekly|The Exchange|Dream Market/i.test(s),
      name + ' still sells the retired product');
    assert.ok(!/\bClay\b/.test(s.replace(/clay-dark/g, '')), name + ' still names Clay');
  }
});

test('there is no feature grid', () => {
  // "Most small businesses choose an all-in-one based on a feature comparison chart, then regret it
  // six months later when the workflow does not fit." A grid wins the purchase and loses the
  // customer, so the page runs the product instead of describing it.
  assert.match(home, /NO FEATURE GRID, DELIBERATELY/);
  assert.match(home, /it runs it/i);
});

test('the proof works before signup, on the real engine', () => {
  // Two dropdowns, no account, nothing stored — and the same rules a paying customer gets. Walked
  // as Ohio: the correction came back plus the statutory agent, with its source.
  assert.match(preview, /THE PUBLIC PREVIEW/);
  assert.match(preview, /compliance\.rulesFor/);
  assert.match(preview, /WHAT THIS ROUTE MUST NOT DO: write anything, take an email/);
  assert.ok(!/INSERT INTO/i.test(preview), 'the preview must not write anything');
  assert.match(server, /app\.use\('\/api\/public'/);
});

test('absence leads the result', () => {
  // Six states require no annual report. Telling somebody that on the homepage is more persuasive
  // than any feature list, because people pay for filings they never needed.
  assert.match(home, /Absence first/);
  const notesIdx = home.indexOf('(d.notes || []).forEach');
  const itemsIdx = home.indexOf('d.items.forEach');
  assert.ok(notesIdx > 0 && notesIdx < itemsIdx, 'notes should render before obligations');
});

test('the same claim is not printed twice', () => {
  // The note rendered its title and then a `says` that opened with the same sentence — read aloud,
  // the same sentence twice in a row.
  assert.match(home, /Read aloud that is the same sentence twice/);
  assert.ok(!/note"><p class="t">' \+ esc\(n\.title\)/.test(home));
});

test('every result carries where it came from', () => {
  assert.match(home, /esc\(i\.source_ref\)/);
  assert.match(preview, /source_ref: o\.source_ref/);
});

test('an unconfirmed fee is admitted on the public page too', () => {
  // Said to a stranger as readily as to a customer.
  assert.match(preview, /Said on the public page as readily as inside the product/);
  assert.match(home, /tells you the fee is unchecked/);
});

test('what she will not do is on the homepage, not three clicks in', () => {
  // Carried from the Penny page on Access Your Place. Every competitor publishes only capabilities;
  // this is the strongest thing in the estate.
  assert.match(home, /CARRIED FROM THE PENNY PAGE ON ACCESS YOUR PLACE/);
  assert.match(home, /What she will not do/);
  assert.match(home, /A failed look is not a\s*\n?\s*clear day/);
});

test('prices are visible without an account', () => {
  // YP Flow has no pricing page at all. This one states the free tier first.
  assert.match(home, /class="amt">Free<\/p>/);
  // Desk $55 and Office $99, owner's decision 16 Sept 2026 (the $49 and $129 here were never decided).
  assert.match(home, /\$55 a month/);
  assert.match(home, /\$99 a month/);
  assert.match(home, /href="\/plans\.html"/);
});

test('a failed look is not a clear day, here too', () => {
  assert.match(home, /that is a failure on '\s*\n?\s*\+ 'our side, not an empty answer/);
});

test('one main, one h1, labelled controls, its own title', () => {
  // Verified in the rendered DOM: mains 1, h1s 1, unlabelled 0, nothing under 44px but the checkbox
  // at its intended 24.
  assert.strictEqual((home.match(/<main/g) || []).length, 1);
  assert.strictEqual((home.match(/<h1/g) || []).length, 1);
  // Branding is Access YP Labs for now, by the owner's call: Penny Desk is not a live domain, and a
  // homepage should not sell a name nobody can reach. Penny keeps her name; the product does not
  // have one on this page yet.
  assert.match(home, /<title>Access YP Labs — the employees you always needed<\/title>/);
  assert.match(home, /role="status" aria-live="polite"/);
});
