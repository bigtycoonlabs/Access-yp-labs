'use strict';
// Found 17 Sept 2026 by the live deep walk: a new member described their business and Penny could not
// put it on file, so she could not record a reminder or research anything for them either.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const W = require('../src/services/clay/workspace');

test('Penny can put a business on file, and is told to rather than sending people elsewhere', () => {
  const t = W.TOOLS.add_business;
  assert.deepStrictEqual(t.required, ['name']);
  assert.ok(t.optional.includes('city') && t.optional.includes('employees'));
  assert.strictEqual(t.requires_confirmation, false);
  assert.ok(t.summary.length < 1024);
  assert.strictEqual(typeof W.EXECUTORS.add_business, 'function');
  const penny = fs.readFileSync('src/services/clay/penny.js', 'utf8');
  assert.match(penny, /'add_business'/);
  assert.match(penny, /Do not send them\nto another page to do it/);
});

test('states are recognised by name or code, never guessed, and duplicates are not added', () => {
  const src = fs.readFileSync('src/services/clay/workspace.js', 'utf8');
  assert.match(src, /texas: 'TX'/);
  assert.match(src, /return STATE_NAMES\[t\.toLowerCase\(\)\] \|\| null/);
  assert.match(src, /I did not recognise/);
  assert.match(src, /is already on file, so I did not add it again/);
  assert.match(src, /localities, trade, headcount, stage\)/);
  // headcount is NOT NULL: unknown is saved as none and the person is told (found in the live walk).
  assert.match(src, /Number\.isFinite\(employees\) \? employees : 0\]\);/);
  assert.match(src, /I have noted no employees besides the owner for now/);
});
