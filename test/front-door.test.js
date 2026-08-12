'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:\/\*|\*|\/\/)?\s*/g, ' ').replace(/\s+/g, ' ');
const home = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/css/kiln.css', 'utf8');

test('the menu is styled as a LIST, not as bare links', () => {
  // When the nav became a real list for screen readers, the styling still targeted `nav.top a` — so
  // the items stacked one per row and the menu grew to 362px on a phone. The accessibility fix was
  // right; not checking it on a phone was the mistake.
  assert.match(home, /nav\.top \.nav-list\{/);
  assert.match(home, /nav\.top\{display:block;\}/);
  assert.match(css, /nav\.top \.nav-list \{/);
});

test('the links do not run together visually', () => {
  // At a 2px gap they read as "HomeThe Exchange" — the same run-together problem the list was
  // meant to fix, visual instead of spoken.
  assert.match(home, /column-gap:14px/);
  assert.match(flat(home), /the links read as one string/i);
});

test('a 44px touch target survives the tighter phone layout', () => {
  // Making the menu shorter must not make it harder to hit.
  assert.match(home, /min-height:44px/);
  assert.match(home, /nav\.top a\{font-size:15px;padding:11px 8px;\}/);
});

test('the reason is written down where the next person will see it', () => {
  // The idea box is the single thing the homepage exists to get somebody to use, and it was sitting
  // below the fold on a phone.
  assert.match(flat(home), /push the idea box below the fold/i);
});

test('Clay\'s answer is brought into view, not just announced', () => {
  // The reply renders below the button, which on a phone put it thirty pixels under the fold and
  // the account button two hundred below that. Somebody typed their idea, tapped, and the screen
  // did not visibly change — the request succeeded, the answer was there, and the one moment this
  // page exists to produce was invisible. It was announced to a screen reader and shown to nobody.
  assert.match(home, /function showResult\(node\)/);
  assert.match(home, /scrollIntoView\(\{behavior:'smooth',block:'start'\}\)/);
  assert.match(flat(home), /BRING IT INTO VIEW/i);
});

test('focus follows the answer', () => {
  // So a keyboard or screen-reader user continues from the answer rather than from where the button
  // used to be.
  assert.match(home, /node\.setAttribute\('tabindex','-1'\)/);
  assert.match(home, /node\.focus\(\{preventScroll:true\}\)/);
});

test('errors are brought into view too', () => {
  // Arguably more than answers: an error nobody sees is indistinguishable from nothing happening.
  const sparkCatch = home.slice(home.indexOf("}catch(e){"), home.indexOf("}catch(e){") + 500);
  assert.match(sparkCatch, /showResult\(out\)/);
  assert.match(flat(home), /Errors need seeing just as much as answers/i);
});

test('the Ask Clay box does the same', () => {
  // Same page, same failure: an answer appended below the fold is an answer nobody sees.
  assert.match(home, /showResult\(log\.lastElementChild\)/);
});
