'use strict';
// THE BUSINESSES SCREEN, and the duplicate it exposed.
//
// Walked on a 390x780 phone against a real server: empty state, then adding a Florida cleaner with
// contractors, then adding the same one again.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const html = fs.readFileSync('public/businesses.html', 'utf8');
const today = fs.readFileSync('public/today.html', 'utf8');
const onboard = fs.readFileSync('src/routes/onboard.js', 'utf8');
const server = fs.readFileSync('src/server.js', 'utf8');

test('nothing is linked until it exists', () => {
  // Three of the four quiet links on Today pointed at pages that were never built. They did not
  // 404 — the catch-all served the retired Access YP Labs marketplace with HTTP 200, so no status
  // check would have caught it. A person clicking "Documents" landed in a different product.
  assert.match(today, /NOTHING IS LINKED UNTIL IT EXISTS/);
  const links = (today.match(/href="\/[a-z-]+\.html"/g) || [])
    .map((h) => h.replace(/href="\/|"/g, ''));
  for (const l of links) {
    assert.ok(fs.existsSync('public/' + l), 'Today links to a page that does not exist: ' + l);
  }
});

test('an unbuilt page returns 404, not 200', () => {
  // Walked: /documents.html, /customers.html and /nonsense.html all 404 now; all thirteen real pages
  // sampled still return 200. Silent success is this estate's dominant defect and this was a fresh
  // instance of it.
  assert.match(server, /A REQUEST FOR A PAGE THAT DOES NOT EXIST MUST NOT RETURN 200/);
  assert.match(server, /app\.get\(\/\\\.html\$\/, \(req, res\)/);
});

test('multi-business is the point, not a setting', () => {
  assert.match(html, /MULTI-BUSINESS IS THE POINT, NOT A SETTING/);
});

test('each business shows what it OWES, not how many records it has', () => {
  // A count is a receipt. What somebody wants at a glance is which of their businesses is about to
  // cost them money.
  assert.match(html, /What each one OWES, not how many records it has/);
  assert.match(html, /esc\(mine\[0\]\.says\)/);
});

test('a failed read is not a clear day, here too', () => {
  assert.match(html, /A failed read is not a clear day/);
  assert.match(html, /I could not check what this one owes just now/);
  assert.match(html, /a failure on our '\s*\n?\s*\+ 'side rather than an empty list/);
});

test('adding a business answers rather than confirming', () => {
  // "Added" tells them nothing. The result is the first true thing the product says about their own
  // business, and it is the whole claim.
  assert.match(html, /THE ANSWER, NOT A RECEIPT/);
  assert.match(html, /esc\(d\.summary\)/);
  assert.match(html, /d\.notes \|\| \[\]/);
});

test('a duplicate is a question, not an error and not a silent second copy', () => {
  // SEEN ON THE PHONE RENDER: "Sunshine Cleaning" listed twice, with two full sets of obligations.
  // The person then owes the Florida annual report twice — worse than not tracking it, because a
  // list that cries wolf stops being read.
  //
  // Not a database constraint: somebody may legitimately run two entities with similar names.
  // Walked: the second add returns 409 with the sentence; with confirm_duplicate it goes through.
  assert.match(onboard, /DUPLICATES ARE A REAL MISTAKE, NOT A HYPOTHETICAL/);
  assert.match(onboard, /you would end up '\s*\n?\s*\+ 'owing everything twice/);
  assert.match(onboard, /!b\.confirm_duplicate/);
  assert.match(html, /A duplicate is a question, not an error/);
});

test('only the name is required', () => {
  assert.match(html, /Only the\s*\n?\s*name is required/);
});

test('it will not guess a formation date', () => {
  // About twenty states set the filing date from it, and inventing one is the failure the rule
  // engine was rebuilt around.
  assert.match(html, /Without it I will not guess\s*\n?\s*one/);
});

test('the checkbox is visible, not just tappable', () => {
  // The row was 44px so a tap anywhere worked, but the box itself rendered at 13px — findable by
  // touch and hard to SEE. The target was fine; the affordance was not.
  assert.match(html, /The target was fine; the affordance was not/);
  assert.match(html, /\.add input\[type=checkbox\]\{width:24px;height:24px/);
});

test('one main, one h1, a live region, and every input labelled', () => {
  // Verified in the rendered DOM: mains 1, h1s 1, unlabelled 0.
  assert.strictEqual((html.match(/<main/g) || []).length, 1);
  assert.strictEqual((html.match(/<h1/g) || []).length, 1);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /<title>Your businesses, Access YP Labs<\/title>/);
});

test('the result is announced and brought into view', () => {
  // A result rendered below the fold is a result nobody saw — the same defect as the confirmation
  // card behind the composer.
  assert.match(html, /a result rendered below the fold is a result nobody saw/i);
  assert.match(html, /scrollIntoView/);
});
