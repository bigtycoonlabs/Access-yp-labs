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

test('the console points at the listing rather than duplicating its editor', () => {
  // Editing lived here while reviewing lived on the moderation screen, so changing a title meant
  // holding a listing in your head across two screens and hoping you were looking at the same one.
  assert.match(page, /Open one to read and edit it/);
  assert.match(page, /moderation\.html#listing-/);
  assert.ok(!/id='t-'\+l\.id|'t-'\+l\.id/.test(page), 'no duplicate title field on the console');
  assert.match(page, /A creator's listing is their work/);
});

test('the console shows what to promote next and lets you log it', () => {
  // The daily marketing loop on one screen: what to post, the link to post, and a way to say you
  // posted it. The API existed with no surface, which is a promise with no button behind it.
  assert.match(page, /id="marketing"/);
  assert.match(page, /'\/console\/marketing'/);
  assert.match(page, /'\/console\/listing\/'\+l\.id\+'\/promoted'/);
  assert.match(page, /I posted it/);
});

test('logging a promotion moves it to the back of the rotation immediately', () => {
  // Otherwise the next thing to post still shows as the thing you just posted.
  const fn = page.slice(page.indexOf("var done=el('button','btn','I posted it')"));
  assert.match(fn.slice(0, 900), /loadMarketing\(\)/);
});

test('a copy that is refused shows the link instead of failing silently', () => {
  // Never leave somebody stuck because the clipboard was refused.
  assert.match(page, /Could not copy automatically\. The link is/);
});

test('channels report posts alongside visits', () => {
  assert.match(page, /x\.posts \+ ' post'/);
  assert.match(page, /x\.visits \+ ' visit'/);
  assert.match(page, /with no source/);
});
