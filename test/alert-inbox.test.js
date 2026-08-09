'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const flat = (s) => s.replace(/\n\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ');
const api = fs.readFileSync(require.resolve('../src/routes/console.js'), 'utf8');
const page = fs.readFileSync('public/console.html', 'utf8');
const notify = fs.readFileSync(require.resolve('../src/services/clay/staffNotify.js'), 'utf8');

test('the list shows OPEN alerts only', () => {
  // It used to show everything from the last seven days regardless of whether anyone had dealt with
  // it, so within a week it was nine items with the urgent ones buried. A list that only grows is
  // one people scroll past — which is how an alerting system dies: not switched off, just ignored.
  assert.match(api, /WHERE resolved_at IS NULL/);
  assert.match(flat(api), /not switched off, just ignored/i);
});

test('urgent alarms sort above routine notes', () => {
  // A new creator signing up is worth telling you. It is not worth telling you FIRST.
  assert.match(api, /ORDER BY \(kind = ANY\(\$1::text\[\]\)\) DESC/);
  assert.match(api, /const URGENT_KINDS = \[/);
  // And that list must stay in step with the one that bypasses the daily cap.
  ['seller_billing_not_stopped', 'webhook_not_recorded', 'seed_failed'].forEach((k) => {
    assert.ok(api.includes(`'${k}'`), k + ' is urgent in the console');
    assert.ok(notify.includes(`'${k}'`), k + ' also bypasses the send cap');
  });
});

test('acknowledging and resolving are separate acts', () => {
  // SEEN is not FIXED. Without the middle state, an alert somebody is actively working on looks
  // identical to one nobody has touched.
  assert.match(api, /router\.post\('\/alerts\/:id\/ack'/);
  assert.match(api, /router\.post\('\/alerts\/:id\/resolve'/);
  assert.match(api, /It stays on the list until it is resolved/);
});

test('resolving requires saying what was done', () => {
  // An alert resolved with "restarted the worker" teaches the next person something; one resolved
  // silently cannot later be told apart from one that was simply dismissed.
  assert.match(api, /if \(!note\)/);
  assert.match(api, /cannot be '\s*\+\s*'told apart later from one that was simply dismissed/);
});

test('an alert cannot be resolved twice', () => {
  assert.match(api, /AND resolved_at IS NULL RETURNING id/);
  assert.match(api, /not open — it may already be resolved/);
});

test('urgency is stated in words, never colour alone', () => {
  assert.match(page, /'Needs action — '/);
  assert.match(page, /somebody is on this/);
});

test('the resolve box focuses the note and gives focus back', () => {
  assert.match(page, /inp\.focus\(\)/);
  assert.match(page, /function restore\(\)/);
  assert.match(page, /no\.addEventListener\('click', function\(\)\{ box\.remove\(\); restore\(\); \}\)/);
});

test('an empty list says so plainly', () => {
  assert.match(page, /No open alerts\. Nothing has gone wrong that you have not already dealt with/);
});
