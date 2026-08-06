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
  assert.match(dash, /if \(l\.status === 'draft'\) \{\s*r\.actions\.appendChild\(actionBtn\('Edit this listing'/);
  assert.match(dash, /\['in_review', 'live'\]\.includes\(l\.status\)/);
  assert.match(flat(dash), /instead of a button that fails, this offers the real sequence as ONE action/i);
});

test('taking a live listing down to edit is confirmed, and says what is kept', () => {
  assert.match(dash, /it comes off the market first/i);
  assert.match(dash, /Your listing and everything in it is kept/i);
  assert.match(dash, /if \(no\.focus\) no\.focus\(\)/);   // focus lands on the safe option
});
