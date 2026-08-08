'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const consultants = fs.readFileSync(require.resolve('../src/routes/consultants.js'), 'utf8');
const profile = fs.readFileSync('public/profile.html', 'utf8');

test('the retired consultant endpoints cannot take money', () => {
  // The pages were retired and the dashboard section removed, but thirteen endpoints stayed live —
  // including one that opens a real $150 Stripe checkout for a product we no longer do.
  const gate = consultants.indexOf('router.use((req, res) =>');
  const firstRoute = consultants.search(/router\.(get|post|patch|delete)\(/);
  assert.ok(gate > -1, 'the router is closed');
  assert.ok(gate < firstRoute, 'and closed BEFORE any handler can run');
  assert.match(consultants, /res\.status\(410\)/);
  assert.match(flat(consultants), /a retired product with a working payment link/i);
});

test('the closure explains what replaced it', () => {
  // A client still calling one deserves to be told it was withdrawn, not that it never existed.
  assert.match(consultants, /Launch partners replaced them/);
  assert.match(consultants, /Nothing has been charged/);
  assert.match(consultants, /replaced_by: '\/partners\.html'/);
});

test('a creator can actually delete their conversation history', () => {
  // The endpoint existed and nothing called it — the same shape as a refund nobody can trigger.
  assert.match(profile, /id="wipe"/);
  assert.match(profile, /Kiln\.api\('\/clay\/history',\{method:'DELETE'\}\)/);
  assert.match(profile, /Staff cannot read them/);
});

test('the delete confirmation focuses the safe option and gives focus back', () => {
  // document.activeElement is BODY when someone clicks with a mouse, and body.focus() does nothing,
  // so trusting it blindly drops the person at the top of the page.
  assert.match(profile, /no\.focus\(\)/);
  assert.match(profile, /\/\^\(BUTTON\|A\|INPUT\|SELECT\|TEXTAREA\)\$\//);
  assert.match(flat(profile), /Only honour it if it is genuinely focusable/i);
});
