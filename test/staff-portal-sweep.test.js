'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:\/\/|--)\s*/g, ' ').replace(/\s+/g, ' ');
const api = fs.readFileSync(require.resolve('../src/routes/console.js'), 'utf8');
const cons = fs.readFileSync('public/console.html', 'utf8');
const ctrl = fs.readFileSync('public/market-control.html', 'utf8');

test('repeated alerts are one row with a count', () => {
  // Seen on screen: four identical "Seller B still billed" cards, each about 240 pixels tall,
  // filling the section. A recurring fault floods the one list that has to stay readable, and the
  // genuinely different alert underneath never gets seen.
  assert.match(api, /GROUP BY kind, subject/);
  assert.match(api, /count\(\*\)::int AS times/);
  assert.match(cons, /a\.times \+ ' times, most recently '/);
});

test('resolving a grouped alert clears the whole group', () => {
  // Clearing one row would drop the count by one and leave the same entry sitting there, which
  // reads as the button not working.
  assert.match(api, /\(kind, subject\) = \(SELECT kind, subject FROM clay_staff_notes WHERE id = \$1\)/);
  assert.match(flat(api), /would drop the count by one and leave the same entry sitting there/i);
});

test('no database word reaches the screen', () => {
  // "in_review" was rendering to staff on two different pages.
  [ctrl, cons].forEach((page) => {
    assert.match(page, /in_review:'waiting for review'/);
  });
  const tools = fs.readFileSync('public/admin-tools.html', 'utf8');
  assert.match(tools, /ACCOUNT\[u\.status\] \|\| u\.status/);
});

test('a status is not said twice in different words', () => {
  // The summary read "in_review · WAITING" — two ways of saying the same thing, neither English.
  assert.ok(!/flags\.push\('WAITING'\)/.test(ctrl));
});

test('a queue that just arrived does not say "waiting 0 hours"', () => {
  // Not a thing anybody says, and it reads as broken rather than as recent.
  assert.match(cons, /arrived in the last hour/);
  assert.match(cons, /q\.oldest_hours < 1/);
});

test('the second filter row has a visible heading', () => {
  // It was screen-reader-only, so a sighted user saw two rows of buttons with no explanation of
  // what the second one did.
  assert.match(ctrl, /<h2 id="f2-h">Whose listings<\/h2>/);
  assert.ok(!/id="f2-h" class="sr-only"/.test(ctrl));
});
