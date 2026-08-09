'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:\/\/|<!--)\s*/g, ' ').replace(/\s+/g, ' ');
const js = fs.readFileSync('public/js/concept.js', 'utf8');
const html = fs.readFileSync('public/concept.html', 'utf8');
const listings = fs.readFileSync(require.resolve('../src/routes/listings.js'), 'utf8');

test('a creator is shown what their project is worth', () => {
  // The valuation was computed on every project and shown to nobody — a complete tier, range and
  // list of what would move it, behind an endpoint no page called. Somebody cannot decide to add
  // another piece if they have never been told what the piece is worth.
  assert.match(html, /id="value-panel"/);
  assert.match(js, /'\/concepts\/' \+ conceptId \+ '\/value'/);
  assert.match(js, /Asking range: \$/);
});

test('the number is never presented as a valuation or a promise', () => {
  // A number attached to somebody's hopes is easy to abuse. Most listed projects do not sell.
  assert.match(js, /not a valuation, and not a promise that it/);
  assert.match(js, /Most listed projects do not/);
});

test('what would raise it is named, not left to be inferred', () => {
  // "Add a marketing strategy" is a chore with no visible payoff until you can see what it moves.
  assert.match(js, /What would raise it/);
  assert.match(js, /Ask Clay to do the next one/);
  assert.match(js, /ask=' \+ encodeURIComponent\(v\.to_raise\[0\]\)/);
});

test('a failed valuation never blocks somebody seeing their own work', () => {
  assert.match(js, /renderValue\(project\.id\)\.catch\(function\(\)\{\}\)/);
  assert.match(flat(js), /a project page that shouts about a failed sidebar is worse/i);
});

test('a creator can edit what their listing says', () => {
  // The existing route changes price and stage and touches the listings table only. The words a
  // buyer reads live on the project, so a creator could change their price but not fix a typo in
  // their own title.
  assert.match(listings, /router\.patch\('\/:id\/story'/);
  assert.match(listings, /UPDATE concepts SET title=\$2/);
  assert.match(listings, /AND l\.seller_id = \$2/);
});

test('editing the words is separate from editing the terms', () => {
  // Changing what something costs and changing what it says are different acts, and a buyer
  // watching a listing should be able to tell which happened.
  assert.match(flat(listings), /Separate from the terms route on purpose/i);
});
