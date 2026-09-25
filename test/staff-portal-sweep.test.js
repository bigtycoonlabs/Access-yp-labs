'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:\/\/|--)\s*/g, ' ').replace(/\s+/g, ' ');
const api = fs.readFileSync(require.resolve('../src/routes/console.js'), 'utf8');

test('repeated alerts are one row with a count', () => {
  // Seen on screen: four identical "Seller B still billed" cards, each about 240 pixels tall,
  // filling the section. A recurring fault floods the one list that has to stay readable, and the
  // genuinely different alert underneath never gets seen.
  assert.match(api, /GROUP BY kind, subject/);
  assert.match(api, /count\(\*\)::int AS times/);
});

test('resolving a grouped alert clears the whole group', () => {
  // Clearing one row would drop the count by one and leave the same entry sitting there, which
  // reads as the button not working.
  assert.match(api, /\(kind, subject\) = \(SELECT kind, subject FROM clay_staff_notes WHERE id = \$1\)/);
  assert.match(flat(api), /would drop the count by one and leave the same entry sitting there/i);
});
