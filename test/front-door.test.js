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
  // At a 2px gap they read as "HomeThe Dream Market" — the same run-together problem the list was
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
