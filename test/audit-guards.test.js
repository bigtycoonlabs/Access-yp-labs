'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/`\s*\+\s*`/g, '').replace(/\s+/g, ' ');
const listings = flat(fs.readFileSync(require.resolve('../src/routes/listings.js'), 'utf8'));
const dash = fs.readFileSync('public/js/dashboard.js', 'utf8');

test('an auction cannot dodge its end date by being edited into one later', () => {
  // The rule lives in ONE place and both paths call it, so create and update can never drift.
  assert.strictEqual((listings.match(/assertAuctionCloses\(/g) || []).length, 3,
    'defined once, called by create and by update');
});

test('a seller can correct a launch partner offer after creating the listing', () => {
  assert.match(listings, /partner_offered === undefined/, 'omitting it leaves the existing offer alone');
  assert.match(listings, /partner_offered=\$9/, 'and the update actually writes it');
});

test('releasing escrow asks first and focuses the safe option', () => {
  assert.match(dash, /function confirmAction/, 'a two-step confirmation exists');
  assert.match(dash, /pays them out of escrow and cannot be undone/i, 'the question states the stakes');
  const helper = dash.slice(dash.indexOf('function confirmAction'), dash.indexOf('async function run'));
  assert.match(helper, /no\.focus\(\)/, 'focus lands on the SAFE option, not the destructive one');
  assert.match(helper, /Confirm required/, 'and it is announced');
});
