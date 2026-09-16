'use strict';
// 062: A MOCK-UP IS OFFERED, NOT REQUIRED, AND A CHARGE STILL NEEDS A RECORDED YES.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const sql = fs.readFileSync('docs/migrations/062_builds_mock_is_a_choice.sql', 'utf8');

test('chargeable needs approval plus a mock or a recorded decision to skip one', () => {
  const flat = sql.replace(/\s+/g, ' ');
  assert.match(flat, /DROP CONSTRAINT IF EXISTS charged_only_after_approval/);
  assert.match(flat, /NOT chargeable OR \(approved_at IS NOT NULL AND \(mock_of IS NOT NULL OR mock_declined_at IS NOT NULL\)\)/);
  assert.match(flat, /mock_declined_at IS NULL OR stage = 'real'/);
});

test('it is in the rebuild order, after 061', () => {
  const order = fs.readFileSync('docs/migrations/ORDER.txt', 'utf8').split('\n');
  assert.ok(order.indexOf('062_builds_mock_is_a_choice.sql') > order.indexOf('061_builds.sql'));
});
