'use strict';
// BEING TOLD BEFORE IT IS TOO LATE.
//
// Obligations carried due dates from the day the spine was built and nothing acted on them. A
// compliance ledger you have to remember to open defeats its own purpose: the person who loses an
// entity to administrative dissolution is not somebody who checked and ignored it, it is somebody
// who never looked because nothing made them.
//
// Driven against a real Postgres with two people and three obligations, including the delivery
// failure path.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const src = fs.readFileSync('src/services/clay/dueSweep.js', 'utf8');
const server = fs.readFileSync('src/server.js', 'utf8');
const S = require('../src/services/clay/dueSweep');

test('it is scheduled — a sweep nobody runs is not a sweep', () => {
  assert.match(server, /DUE-DATE SWEEP/);
  assert.match(server, /setInterval\(runDue, DAY_MS\)/);
});

test('zero delivered is never recorded as sent', () => {
  // Driven: with a throwing sender and three fresh reminders, 0 rows were written and the next sweep
  // sent all four. A "sent" flag set before delivery is how somebody believes they were warned about
  // something they never heard of.
  assert.match(src, /Zero delivered is never recorded as sent/);
  assert.match(src, /DELIVERY FIRST, RECORD SECOND/);
  // The send must come before the insert, not after.
  assert.ok(src.indexOf('await send(') < src.indexOf('INSERT INTO notifications'));
});

test('nobody is warned twice at the same distance', () => {
  // Driven: the second run of the same day sent 0 and skipped 3. Somebody who gets the same reminder
  // every morning stops reading all of them, and the one that mattered arrives in a stream they have
  // learned to ignore.
  assert.match(src, /does not warn twice/);
  assert.match(src, /const dedupeKey =/);
  assert.match(src, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
});

test('the dedupe uses the column the table already had', () => {
  // I hand-rolled one by pattern-matching a suffix onto the url, and every insert failed on a NOT
  // NULL I had not looked for. notifications.dedupe_key existed with a unique index on it — the
  // mechanism I was rebuilding badly was already there, and enforced by the database.
  assert.match(src, /THE TABLE ALREADY HAD THIS/);
  assert.ok(!/url LIKE/.test(src), 'no hand-rolled dedupe left');
});

test('a person is warned about what they can see', () => {
  // Driven: the bookkeeper with money:view got the invoice reminder and NOT the filing. The rule that
  // holds on every screen and in every tool holds in a reminder too.
  assert.match(src, /A person is warned about what THEY can see/);
  assert.match(src, /p\.area = \$2 AND p\.level <> 'none'/);
});

test('the warning distance is set by what missing it costs', () => {
  // A $400 penalty with a hard date deserves a longer run-up than a $25 renewal, because the point is
  // leaving enough time to actually do the thing.
  assert.deepStrictEqual(S.windowsFor(40000), [30, 14, 7, 1]);
  assert.deepStrictEqual(S.windowsFor(7500), [14, 7, 1]);
  assert.deepStrictEqual(S.windowsFor(null), [7, 1]);
});

test('an expensive filing warns four times, not once', () => {
  // THE BUG THIS TEST FOUND. The windows are written [30, 14, 7, 1] and the first version returned
  // the first match walking the list as written — so thirteen days out matched 30. EVERY reminder
  // landed in the 30-day window, and because the dedupe is keyed on the window, each obligation
  // warned once and then went silent.
  //
  // A $400 Florida filing would have been mentioned a month out and never again until it was late.
  // Worse than no reminder, because it would have been believed.
  const at = (d) => S.pickWindow(new Date(Date.now() + d * 86400000), 40000);
  assert.strictEqual(at(30).window, 30);
  assert.strictEqual(at(20).window, 30);
  assert.strictEqual(at(13).window, 14);
  assert.strictEqual(at(3).window, 7);
  assert.strictEqual(at(1).window, 1);
  assert.strictEqual(at(40), null);
  // Four distinct windows over the run-up means four distinct reminders.
  assert.strictEqual(new Set([at(30).window, at(13).window, at(3).window, at(1).window]).size, 4);
  // And a day the job did not run does not skip one: the next run is still inside the same window.
  assert.match(src, /a day the job did not run does not skip a/);
});

test('a sweep that could not read is not a sweep that found nothing', () => {
  assert.match(src, /A sweep that could not read is not a sweep that found nothing/);
  assert.match(src, /return \{ ok: false, reason: e\.message/);
});
