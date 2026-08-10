'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const core = fs.readFileSync(require.resolve('../src/services/moderationCore.js'), 'utf8');
// Reviewing moved to the control centre; this promise had to move with it.
const page = fs.readFileSync('public/market-control.html', 'utf8');

test('a staff member cannot approve their own listing', () => {
  assert.match(core, /listing\.seller_id === user\.id && !isOperator/);
  assert.match(core, /You must recuse yourself/);
  assert.match(core, /auto-recused: moderator is the seller/);
});

test('an owner CAN, but it is never silent', () => {
  // Somebody has to seed the market. The point is that it is recorded, with a name on it.
  assert.match(core, /SELF-REVIEW: the platform owner approved their own listing/);
  // Even when they write their own note, the self-review marker survives.
  assert.match(core, /notes \? selfNote \+ ' ' \+ notes : selfNote/);
});

test('the page says what is actually true, including for owners', () => {
  // It used to promise 'you cannot rule on your own listing' to everyone — false for the people
  // most likely to be reading it.
  assert.ok(!/You cannot rule on your own listing; the system recuses you automatically/.test(page));
  assert.match(page, /Platform owners CAN approve their own/);
  assert.match(page, /recorded in the log as a self-review/);
});
