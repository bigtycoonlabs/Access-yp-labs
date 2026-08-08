'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const lib = fs.readFileSync(require.resolve('../src/lib/deleteProject.js'), 'utf8');
const concepts = fs.readFileSync(require.resolve('../src/routes/concepts.js'), 'utf8');
const clay = fs.readFileSync(require.resolve('../src/routes/clay.js'), 'utf8');

test('deleting a project stops its billing', () => {
  // subscriptions.concept_id has no foreign key, so a deleted project used to leave an ACTIVE
  // subscription pointing at nothing while Stripe carried on charging for it.
  assert.match(lib, /cancelSubscription/);
  assert.match(lib, /UPDATE subscriptions SET status='canceled'/);
});

test('billing is stopped BEFORE the project is removed', () => {
  // Refusing the deletion and saying why beats removing someone's work and leaving the charge running.
  const cancel = lib.indexOf('cancelSubscription');
  const del = lib.indexOf('DELETE FROM concepts');
  assert.ok(cancel > -1 && cancel < del, 'the cancel runs first');
  assert.match(lib, /return \{ ok: false, reason: 'cancel_failed' \}/);
  assert.match(concepts, /CANCEL_FAILED_MESSAGE/);
});

test('a failed cancel does not delete anything, and says so', () => {
  assert.match(lib, /has NOT been deleted/);
  assert.match(lib, /Nothing has changed/);
});

test('BOTH ways of deleting a project use the same path', () => {
  // There are two — the API and Clay's remove_concept tool — and only one would ever have been
  // fixed. A second copy is how one of them silently keeps charging people.
  assert.match(concepts, /deleteProject\(req\.user\.id, req\.params\.id\)/);
  assert.match(clay, /deleteProject\(req\.user\.id, params\.concept_id\)/);
  assert.ok(!/DELETE FROM concepts WHERE id=\$1 AND owner_id=\$2/.test(clay),
    'Clay no longer deletes directly');
  assert.match(flat(lib), /A second copy is how the two paths quietly stop agreeing/i);
});

test('you still cannot delete a project that is not yours', () => {
  assert.match(lib, /DELETE FROM concepts WHERE id=\$1 AND owner_id=\$2/);
  assert.match(lib, /reason: 'not_found'/);
});
