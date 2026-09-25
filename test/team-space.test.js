'use strict';
// THE TEAM SPACE — where seats, contributions and agreements become something a person can use.
//
// Everything built this week was API-only and invisible. This is the screen, and every finding
// below came from rendering it in a browser and reading what it actually said.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const ag = fs.readFileSync('src/routes/agreements.js', 'utf8');

test('one row per person, however many ways they are involved', () => {
  // Found by reading the rendered page: somebody holding a seat who also had work accepted appeared
  // twice — "ts1a holds a seat" AND "ts1a contributed work".
  //
  // Cosmetic on screen and serious underneath: this list is what the agreement validator uses to
  // decide who must be named and who must sign. A duplicated person would have been asked to sign
  // twice and had their share counted twice against the 100%.
  //
  // DISTINCT did not help — the rows differ by role, so both survived it.
  assert.match(ag, /SELECT DISTINCT ON \(u\.id\)/);
  assert.match(ag, /ORDER BY u\.id, CASE r\.role WHEN 'owner' THEN 1 WHEN 'seat' THEN 2 ELSE 3 END/);
  assert.match(ag, /ONE ROW PER PERSON, not one per way they are involved/);
});
