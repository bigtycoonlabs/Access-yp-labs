'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const enter = fs.readFileSync('public/enter.html', 'utf8');
const app = fs.readFileSync('public/app.html', 'utf8');
const appjs = fs.readFileSync('public/js/app.js', 'utf8');

test('nobody answers questions before seeing what is for sale', () => {
  // Reaching a listing meant marketplace -> enter -> dreamhold: seven category buttons and two
  // Continues before a single project was visible. The lab code says the door "made everyone answer
  // these before they could go in" and was replaced — it was not; it was still first in the chain.
  assert.ok(!/location\.replace\('\/dreamhold\.html'\)/.test(enter), 'the gate no longer redirects');
  assert.match(flat(enter), /THE TUNING GATE IS GONE/i);
});

test('the same tuning is still available, just not demanded', () => {
  assert.match(appjs, /function maybeOfferTuning\(\)/);
  assert.match(appjs, /'Tune it to me'/);
});

test('category is not asked for either', () => {
  // Its own label said "optional — Clay can decide", and he does decide it. A control whose label
  // admits it is unnecessary should not occupy a menu.
  assert.ok(!/<select id="category"/.test(app), 'the picker is gone');
  assert.match(app, /<input type="hidden" id="category"/);
  // The send path is unchanged: it submits empty, which is what "Let Clay decide" always sent.
  assert.match(appjs, /categoryEl/);
});
