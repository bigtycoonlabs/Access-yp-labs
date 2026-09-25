'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:\/\/|<!--)\s*/g, ' ').replace(/\s+/g, ' ');
const api = fs.readFileSync(require.resolve('../src/routes/marketAdmin.js'), 'utf8');
const consoleApi = fs.readFileSync(require.resolve('../src/routes/console.js'), 'utf8');

test('the review queue is gone and its address still lands somewhere real', () => {
  // It only ever showed listings awaiting review, could not edit them, and the console linked there
  // for Clay's listings — so clicking a Clay listing landed somebody on a screen where they could
  // not change a thing.
  const mod = fs.readFileSync('public/moderation.html', 'utf8');
  assert.match(mod, /location\.replace\('\/market-control\.html'\)/);
  assert.match(flat(mod), /THE REVIEW QUEUE IS GONE, ON PURPOSE/i);
  assert.ok(!/moderation\.html/.test(consoleApi), 'nothing points at the old queue');
});

test('the counts come from the same rows as the list', () => {
  // Computing them separately is how a badge says 3 while the list shows 2.
  assert.match(api, /const counts = \{/);
  assert.match(api, /all\.filter\(\(x\) => x\.status === 'in_review'\)\.length/);
  assert.match(flat(api), /the counts have to agree with the list/i);
});
