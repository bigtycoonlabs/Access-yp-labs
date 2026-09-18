'use strict';
// THE DEMO THAT WAS ON THE HOMEPAGE.
//
// A visitor could pick a state and see real filings before signing up. Three tests here guarded how
// it answered: absence first, no claim printed twice, and every figure carrying its source. The
// owner removed the box on 17 Sept 2026 — compliance is the narrowest part of the platform and it
// was standing at the front door as though it were the whole of it — so those three tests went with
// the thing they described. The rules themselves still hold wherever an answer is shown; they are
// enforced where the answering now happens.
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









test('what she will not do is on the homepage, not three clicks in', () => {
  // Carried from the Penny page on Access Your Place. Every competitor publishes only capabilities;
  // this is the strongest thing in the estate.
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



test('one main, one h1, labelled controls, its own title', () => {
  // Verified in the rendered DOM: mains 1, h1s 1, unlabelled 0, nothing under 44px but the checkbox
  // at its intended 24.
  assert.strictEqual((home.match(/<main/g) || []).length, 1);
  assert.strictEqual((home.match(/<h1/g) || []).length, 1);
  // Branding is Access YP Labs for now, by the owner's call: Penny Desk is not a live domain, and a
  // homepage should not sell a name nobody can reach. Penny keeps her name; the product does not
  // have one on this page yet.
  assert.match(home, /<title>Access YP Labs — the employees you always needed<\/title>/);
  // The live region went with the demo: nothing on this page answers anything now.
});
