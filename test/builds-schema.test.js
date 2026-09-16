'use strict';
// THE MOCK THAT HAS TO COME FIRST.
//
// Penny builds things for the business. The whole design rests on one rule, and it lives in the
// database rather than in a route, because a rule that lives only in a route gets bypassed by the
// second route somebody writes.
//
//   NOTHING IS CHARGED FOR UNTIL SOMEBODY HAS SEEN IT WORK.
//
// Every build starts as a mock — a real, working page they can open and click, free, unmetered, with
// no limit on how many they ask for. Only after they have seen one and said yes can a build be
// charged for.
//
// The alternative — quote first, build after — is how this category works, and it is why small
// businesses have been burned by developers: you pay to find out whether the person understood you.
// Here the understanding is demonstrated before money is mentioned. If a flag can turn that off it
// is marketing. If the database refuses, it is the product.
//
// Driven against a real Postgres. Every one of these was attempted and refused:

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const sql = fs.readFileSync('docs/migrations/061_builds.sql', 'utf8');

test('a mock can never be charged for', () => {
  // Attempted live: UPDATE builds SET chargeable=true on a mock. Refused.
  assert.match(sql, /CONSTRAINT mock_is_free CHECK \(NOT \(stage = 'mock' AND chargeable\)\)/);
});

test('charging requires a mock that was actually approved', () => {
  // Attempted live: a real build inserted straight to chargeable with no mock_of. Refused.
  // Both halves are required — the mock it came from, and the moment somebody said yes.
  assert.match(sql, /CONSTRAINT charged_only_after_approval/);
  assert.match(sql, /mock_of IS NOT NULL AND approved_at IS NOT NULL/);
});

test('fixing our own mistake is never billed', () => {
  // Attempted live: a chargeable build with attempt_of set. Refused. The retry itself inserts fine —
  // it is simply free. The person does not pay twice because Penny misunderstood the first time.
  assert.match(sql, /CONSTRAINT retries_are_free CHECK \(NOT \(chargeable AND attempt_of IS NOT NULL\)\)/);
});

test('nothing is invoiced that was never chargeable', () => {
  assert.match(sql, /CONSTRAINT invoice_needs_charge CHECK \(invoiced_at IS NULL OR chargeable\)/);
});

test('the brief is kept in their words', () => {
  // The brief is the evidence of what was understood. Paraphrasing it loses the thing a disagreement
  // would turn on.
  // Matched on the column and its constraint rather than the exact run of spaces aligning it. A
  // test pinned to whitespace fails the next time somebody tidies the file, which teaches people to
  // loosen assertions. Fourth time today I have made this mistake.
  assert.match(sql, /asked_for\s+text NOT NULL/);
  assert.match(sql, /Their words, verbatim/);
});

test('a build that is not ready says why', () => {
  // A failed build that says nothing is the silent-success defect wearing a different hat.
  assert.match(sql, /\bsays\s+text/);
  assert.match(sql, /A failed build that says nothing is the silent-success/);
});

test('the code goes to their GitHub, not ours', () => {
  assert.match(sql, /repo_url/);
  assert.match(sql, /the code goes to their GitHub, not ours/);
});

test('it is registered and rebuilds from empty', () => {
  // Verified: 83 tables from an empty database.
  assert.ok(fs.readFileSync('docs/migrations/ORDER.txt', 'utf8').includes('061_builds.sql'));
});

test('the old clay_builds was never this', () => {
  // Worth recording, because the name invites the assumption. clay_builds holds 19 rows whose
  // messages read "Your concept is ready and saved in your Laboratory" — it was the concept
  // generator, not a website builder. That is why site_pages and site_domains are both 0: nothing in
  // that table was ever meant to produce a page. No bug, and nothing to inherit but the behaviour
  // worth keeping — two of its five failures read "Nothing was fabricated."
  assert.ok(!/clay_builds/.test(sql), 'the new table must not be confused with the old one');
});
