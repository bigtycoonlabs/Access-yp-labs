'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:\/\/)?\s*/g, ' ').replace(/\s+/g, ' ');
const listing = fs.readFileSync('public/listing.html', 'utf8');
const pres = fs.readFileSync(require.resolve('../src/services/clay/seedPresentation.js'), 'utf8');
// The review job moved to the control centre; the warning moved with it.
const mod = fs.readFileSync('public/market-control.html', 'utf8');

test('a missing brief makes the opportunity panel vanish entirely', () => {
  // This is the behaviour that made the finding matter: it returns null rather than degrading, so a
  // buyer sees a price, a risk note, and no explanation of what they would be buying. In production
  // twelve of thirteen live listings were in that state.
  assert.match(listing, /const b=listing\.brief; if\(!b \|\| typeof b!=='object'\) return null;/);
});

test('every seeded project gets a brief built with it', () => {
  assert.match(pres, /async function buildBrief\(concept\)/);
  assert.match(pres, /ensureBriefFor/);
  assert.match(pres, /result\.brief = await buildBrief\(concept\)/);
  assert.match(flat(pres), /the four lines a buyer actually reads/i);
});

test('review warns before a listing without one goes live', () => {
  // The last moment somebody can notice.
  assert.ok(mod.includes('No brief. On the public listing'));
  assert.ok(mod.includes('that panel does not appear at '));
  assert.ok(mod.includes('Have Clay write the brief'), 'and the fix is on the same screen');
});

test('the console says whether the brief was built', () => {
  // "Built a landing page" while the thing a buyer reads is still missing would be a half-truth.
  const route = fs.readFileSync(require.resolve('../src/routes/seedListings.js'), 'utf8');
  assert.match(route, /made\.push\('the opportunity brief'\)/);
  assert.match(route, /skipped\.push\('opportunity brief \(/);
});
