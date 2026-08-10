'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*(?:\/\/|<!--)\s*/g, ' ').replace(/\s+/g, ' ');
const api = fs.readFileSync(require.resolve('../src/routes/marketAdmin.js'), 'utf8');
const page = fs.readFileSync('public/market-control.html', 'utf8');
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

test('one page does reviewing, editing, deciding and seeing', () => {
  ['What a buyer reads', 'The listing', 'Decide', 'See it'].forEach((h) => {
    assert.ok(page.includes(h), h + ' is on the page');
  });
  assert.match(page, /Approve — put it on the market/);
  assert.match(page, /Have Clay write the brief/);
  assert.match(page, /Save this listing/);
});

test('the filters are the ones a person actually thinks in', () => {
  assert.match(page, /data-status="waiting"/);
  assert.match(page, /data-status="live"/);
  assert.match(page, /data-owner="clay"/);
  assert.match(page, /data-owner="creators"/);
  // Real buttons with pressed state, so a screen reader says which view is on.
  assert.match(page, /aria-pressed/);
});

test('the counts come from the same rows as the list', () => {
  // Computing them separately is how a badge says 3 while the list shows 2.
  assert.match(api, /const counts = \{/);
  assert.match(api, /all\.filter\(\(x\) => x\.status === 'in_review'\)\.length/);
  assert.match(flat(api), /the counts have to agree with the list/i);
});

test("a creator's listing is edited through the route meant for it", () => {
  // Clay's go through the staff editor; a creator's own words go through the route that only ever
  // touches the fields a listing needs.
  assert.match(page, /l\.is_clays \? \('\/seed-listings\/'\+l\.id\) : \('\/listings\/'\+l\.id\+'\/story'\)/);
});

test('a rejection cannot be recorded without a reason', () => {
  // That reason is read by the person who made it.
  assert.match(page, /Say why you are rejecting it/);
});
