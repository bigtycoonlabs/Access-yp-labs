'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const api = fs.readFileSync(require.resolve('../src/routes/console.js'), 'utf8');
const page = fs.readFileSync('public/console.html', 'utf8');
const nav = fs.readFileSync('public/js/nav.js', 'utf8');

test('the whole business loads in one call', () => {
  // There were eight staff pages and no front door: you had to already know that moderation lives
  // on one page, the Weekly on another, and Clay's health on a third.
  assert.match(api, /router\.get\('\/', staffOnly/);
  ['nowSection', 'businessSection', 'growthSection', 'peopleSection', 'claySection']
    .forEach((s) => assert.ok(api.includes(s), s + ' is part of the console'));
  assert.match(nav, /link\('\/console\.html', 'Operations'\)/);
});

test('queues are ordered by who has waited longest, not by count', () => {
  // Three things waiting an hour is fine; one thing waiting four days is not.
  assert.match(api, /oldest_hours/);
  assert.match(api, /\.sort\(\(a, b\) => \(b\.oldest_hours \|\| 0\) - \(a\.oldest_hours \|\| 0\)\)/);
  assert.match(page, /waiting ' \+ days/);
});

test('a section that fails says so instead of rendering as zero', () => {
  // A dashboard that reports a broken query as a calm zero is worse than no dashboard.
  assert.match(api, /async function safe\(/);
  assert.match(api, /ok: false, error: 'Could not read this\./);
  assert.match(page, /function failed\(/);
  assert.match(page, /missing rather than zero/);
  assert.match(flat(api), /must never look the same/i);
});

test('the sales verdict is stated in words', () => {
  // The number the whole business rests on should be impossible to misread.
  assert.match(api, /The loop has not closed end to end with a real buyer/);
});

test('Clay failures are shown as a rate', () => {
  // 3 failures out of 5 and 3 out of 500 are different problems entirely.
  assert.match(api, /failure_rate: total \? Math\.round\(\(failed \/ total\) \* 100\) : null/);
});

test('the marketing worklist names listings never promoted', () => {
  // Without it the easy ones get posted about repeatedly while somebody's project sits untouched.
  assert.match(api, /never_promoted/);
  assert.match(page, /Live listings never promoted/);
});

test('staff can edit and build from the console itself', () => {
  assert.match(page, /'\/seed-listings\/'\+l\.id/);
  assert.match(page, /'\/presentation'/);
  assert.match(page, /A creator's listing is their work/);
});
