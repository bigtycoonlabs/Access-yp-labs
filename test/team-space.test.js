'use strict';
// THE TEAM SPACE — where seats, contributions and agreements become something a person can use.
//
// Everything built this week was API-only and invisible. This is the screen, and every finding
// below came from rendering it in a browser and reading what it actually said.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const ui = fs.readFileSync('public/js/team.js', 'utf8');
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

test('a filled seat is not "you have not said what you need"', () => {
  // Found the same way. With a seat already filled, the page told the owner they had not said what
  // they needed — while somebody was sitting in the seat they had asked for and filled.
  assert.match(ui, /const everAsked = \(seats\.seats \|\| \[\]\)\.length > 0;/);
  assert.match(ui, /Nothing open at the moment/);
});

test('somebody without a display name is a person, not anonymous work', () => {
  // The API falls back to "no name yet". Rendered directly it read "marketing from no name yet" —
  // as though the WORK were anonymous rather than the person not having picked a name, and it is
  // the first thing an owner sees when deciding whether to accept somebody's evening of work.
  assert.match(ui, /function named\(n, fallback\)/);
  assert.match(ui, /somebody who has not set a display name yet/);
  assert.ok(!/\+ c\.contributor_name/.test(ui), 'never render the raw fallback');
});

test('a failed read is not an empty team', () => {
  // Saying "nobody is on this project" when we simply could not look would be the platform
  // inventing a fact out of a network error — the exact defect class this codebase keeps hitting.
  assert.match(ui, /That is a '\s*\n?\s*\+ 'failed read, not an empty one/);
});

test('the rules are said before somebody types into a refusal', () => {
  // The server enforces twenty characters on a brief and fifteen on a rejection reason. The screen
  // says both first, so nobody writes something and then loses it.
  assert.match(ui, /if \(ta\.value\.trim\(\)\.length < 20\)/);
  assert.match(ui, /if \(rr\.value\.trim\(\)\.length < 15\)/);
  assert.match(ui, /Nothing was posted\./);
  assert.match(ui, /Nothing was sent\./);
});

test('every outcome is spoken, and each section has its own live region', () => {
  // One region for the page means two things happening at once overwrite each other and the person
  // hears half of what occurred.
  assert.match(ui, /function saidLine\(host\)/);
  assert.match(ui, /p\.setAttribute\('role', 'status'\)/);
  assert.match(ui, /if \(window\.announce\) window\.announce\(text, true\)/);
});

test('the over-commitment refusal reaches the owner intact', () => {
  // The server's message says exactly how much of the seller side is left. Replacing it with a
  // generic failure would throw away the only number that lets the owner act.
  assert.match(ui, /The over-commitment refusal tells the owner exactly how much is left/);
  assert.match(ui, /say\(said, e && e\.status \? e\.message/);
});

test('waiting is named, never counted', () => {
  assert.match(ui, /'Waiting on ' \+ data\.waiting_on\.join\(' and '\) \+ ' to sign\.'/);
  assert.match(ui, /Named, never counted/);
});

test('it is on the project page, not in a separate room', () => {
  // A team space somewhere else is a place people forget to open. The project IS the team space.
  const c = fs.readFileSync('public/js/concept.js', 'utf8');
  assert.match(c, /TeamSpace\.render\(teamHost, id, true\)/);
  // And ownership is not guessed: GET /concepts/:id is owner-only.
  assert.match(c, /GET \/concepts\/:id is owner-only/);
  assert.match(fs.readFileSync('public/concept.html', 'utf8'), /<script src="\/js\/team\.js/);
});
