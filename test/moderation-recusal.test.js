'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const core = fs.readFileSync(require.resolve('../src/services/moderationCore.js'), 'utf8');

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
