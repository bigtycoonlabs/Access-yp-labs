'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const consultants = fs.readFileSync(require.resolve('../src/routes/consultants.js'), 'utf8');
const profile = fs.readFileSync('public/profile.html', 'utf8');

test('the retired consultant endpoints cannot take money', () => {
  // Thirteen endpoints stayed live after the pages were retired, including one that opened a real
  // $150 Stripe checkout for a product we no longer do. They were closed at the router with the
  // handlers left intact and unreachable beneath it.
  //
  // The product is now retired outright, so the handlers are gone as well. There is nothing left to
  // gate: no route can run because no route is defined. Asserting the gate comes FIRST no longer
  // means anything, so this asserts the stronger thing — that there is nothing after it.
  assert.match(consultants, /res\.status\(410\)/);
  assert.ok(!/router\.(get|post|patch|delete)\(/.test(consultants),
    'a retired router must define no handlers at all');
  // Comments stripped: the router should still EXPLAIN what was retired and why. What must not
  // survive is code that touches the retired tables or the deleted checkout.
  const code = consultants.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.ok(!/consultant_applications|consultant_engagements|createConsultCheckout/.test(code),
    'no dead handler may still reference the retired tables or the deleted checkout');
  assert.match(flat(consultants), /a retired product with a working payment link/i);
  // 200 lines of dead code referencing a deleted payment function is how a closed door quietly
  // reopens: somebody removes the gate to tidy up, and thirteen endpoints come back.
  assert.ok(consultants.split('\n').length < 60, 'the retired router should be its explanation and its gate');
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
