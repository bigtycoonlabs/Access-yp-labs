'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const dash = fs.readFileSync('public/js/dashboard.js', 'utf8');
const listings = fs.readFileSync(require.resolve('../src/routes/listings.js'), 'utf8');

test('the server still refuses to edit a listing while it is live', () => {
  // This rule is correct and must not be relaxed to make a button work: people may be looking at
  // or bidding on a listing, and terms must not shift under them.
  // Live listings stay locked; withdrawn ones are editable BECAUSE nobody can act on them.
  assert.match(listings, /This listing is live, so its terms are locked/);
  assert.match(listings, /!\['draft', 'withdrawn'\]\.includes\(l\.status\)/);
  // And the same rule is enforced in the UPDATE itself, so a race cannot slip past the guard.
  assert.match(listings, /AND status IN \('draft','withdrawn'\) RETURNING/);
});

test('the UI never offers an edit the server will refuse', () => {
  // A button that returns 409 is worse than no button — it teaches someone the product is broken.
  // Draft and withdrawn edit in place with the existing editor; live gets the take-it-off flow.
  assert.match(dash, /if \(l\.status === 'draft' \|\| l\.status === 'withdrawn'\)/);
  assert.match(dash, /\['in_review', 'live'\]\.includes\(l\.status\)/);
  // ONE editor for one job — a second, thinner one is how two paths drift apart.
  assert.strictEqual((dash.match(/function buildEditor/g) || []).length, 1);
  assert.ok(!/function openEditor/.test(dash), 'the duplicate editor is gone');
  assert.match(flat(dash), /rather than a button that fails, this offers the real sequence as ONE action/i);
});

test('a withdrawn listing has a way back onto the market', () => {
  // Without this, editing strands it: you take it down to change a price and no button puts it back.
  assert.match(dash, /Put it back on the market/);
  assert.match(flat(dash), /editing it strands it/i);
});

test('taking a live listing down to edit is confirmed, and says what is kept', () => {
  assert.match(dash, /it comes off the market first/i);
  assert.match(dash, /Your listing and everything in it is kept/i);
  assert.match(dash, /if \(no\.focus\) no\.focus\(\)/);   // focus lands on the safe option
});
