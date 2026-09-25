'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/`\s*\+\s*`/g, '').replace(/\s+/g, ' ');
const dash = fs.readFileSync('public/js/dashboard.js', 'utf8');

test('releasing escrow asks first and focuses the safe option', () => {
  assert.match(dash, /function confirmAction/, 'a two-step confirmation exists');
  assert.match(dash, /pays them out of escrow and cannot be undone/i, 'the question states the stakes');
  const helper = dash.slice(dash.indexOf('function confirmAction'), dash.indexOf('async function run'));
  assert.match(helper, /no\.focus\(\)/, 'focus lands on the SAFE option, not the destructive one');
  assert.match(helper, /Confirm required/, 'and it is announced');
});
