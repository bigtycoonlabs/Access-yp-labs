'use strict';
// YOUR OWN WORK COMES FIRST.
//
// Measured on a 390x780 phone, signed in, with real data: the dashboard was 9,996 pixels — 12.8
// screenfuls — and "Your projects", the reason a creator opens this page at all, started at y=2,549.
//
// Three screenfuls of coaching came before it: Your path (1,078px), Today's Projects (342px, which
// are recommendations for OTHER people's work), and Your proof step this week (655px). "Your
// Exchange listings" — the part that makes money — sat at y=7,382. Nine screenfuls down.
//
// Guidance is worth having and it does not go first. Somebody opening their own dashboard is looking
// for their own things.
//
// Measured after: 8,520 pixels, 10.9 screens, Your projects at y=407, listings at y=2,314, first
// action at y=639 instead of 840 — above the fold rather than below it. No JavaScript errors.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const dash = fs.readFileSync('public/dashboard.html', 'utf8');
const order = [...dash.matchAll(/<h2 id="([a-z]+)-h"/g)].map((m) => m[1]);

test('a creator sees their own projects before any coaching', () => {
  assert.strictEqual(order[0], 'con', 'Your projects must be first');
  assert.ok(order.indexOf('con') < order.indexOf('path'));
  assert.ok(order.indexOf('con') < order.indexOf('today'));
  assert.ok(order.indexOf('con') < order.indexOf('proofstep'));
});

test('and their listings before it too, because that is the part that earns', () => {
  assert.ok(order.indexOf('lst') < order.indexOf('path'));
  assert.ok(order.indexOf('lst') < order.indexOf('board'));
});

test('the coaching is kept, not deleted', () => {
  // It reads as help when it follows and as a gate when it leads. All three are still on the page.
  for (const id of ['path', 'today', 'proofstep', 'board']) {
    assert.ok(order.includes(id), id + ' must still be here');
  }
});

test('settings fold; nothing about the state of your work does', () => {
  // Display name, subscription and tuning are 1,701px of FORMS. Same rule the console fold
  // established: the things you go and change may fold, the things telling you where you stand
  // may not.
  for (const id of ['pen', 'sub', 'tune']) {
    assert.ok(new RegExp('<details><summary><h2 id="' + id + '-h"').test(dash), id + ' should fold');
  }
  for (const id of ['con', 'lst', 'ord', 'wat', 'pay', 'board']) {
    assert.ok(!new RegExp('<details><summary><h2 id="' + id + '-h"').test(dash), id + ' must not fold');
  }
});

test('every section is still present after the reorder', () => {
  // A reorder that quietly drops a section is worse than the ordering it fixed.
  for (const id of ['con', 'lst', 'ord', 'wat', 'pay', 'path', 'today', 'proofstep', 'board', 'pen', 'sub', 'tune']) {
    assert.ok(order.includes(id), id + ' went missing in the reorder');
  }
  assert.strictEqual(order.length, 12);
});
