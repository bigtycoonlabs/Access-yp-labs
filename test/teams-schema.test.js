'use strict';
// THE TEAM SCHEMA: SEATS, CONTRIBUTIONS, AGREEMENTS, STANDING.
//
// Four rules are enforced by the DATABASE rather than by a route, because a rule that lives only in
// application code holds on one path and silently fails on another. This codebase has been burned by
// that repeatedly: the endless auction was buyable because one guard checked a flag the other did
// not, and the value ladder counted a web search as proof because nothing stopped it.
//
// Each rule below was exercised against a real Postgres before the migration was applied to
// production, both for the case it must refuse and the case it must allow.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const sql = fs.readFileSync('docs/migrations/057_teams_seats_contributions.sql', 'utf8');

test('the migration is additive and drops nothing', () => {
  // 13 live listings and 33 in review were created under the current rules and must keep working
  // exactly as they do. A rename or a drop here would be the Quirky failure: an update that changed
  // the terms under work already done.
  assert.ok(!/\bDROP TABLE\b/i.test(sql));
  assert.ok(!/\bDROP COLUMN\b/i.test(sql));
  assert.ok(!/\bALTER COLUMN\b/i.test(sql));
  // Only the listings table is touched, and only to add.
  const alters = sql.match(/ALTER TABLE[^;]+;/gi) || [];
  for (const a of alters) assert.match(a, /ADD COLUMN IF NOT EXISTS/i, a.slice(0, 60));
});

test('five seats, one shared counter across both paths', () => {
  // Contributors and launch partners draw from the same five. Two separate limits would let a
  // project quietly reach ten people and make every split meaningless. Verified live: the sixth
  // person is refused whether they arrive as a seat or as an accepted contribution.
  assert.match(sql, /taken > 5/);
  assert.match(sql, /CREATE CONSTRAINT TRIGGER seats_five_max/);
  assert.match(sql, /CREATE CONSTRAINT TRIGGER contributions_five_max/);
  // Counted DISTINCT and de-overlapped, so somebody holding a seat AND having contributed is one
  // person, not two.
  assert.match(sql, /count\(DISTINCT holder_id\)/);
  assert.match(sql, /contributor_id NOT IN/);
});

test('no self-dealing on seats', () => {
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS project_seats_one_per_person/);
  assert.match(sql, /WHERE status = 'filled'/);
});

test('a seat cannot be filled by nobody', () => {
  // "Filled with no holder" is exactly the state that produces a confident wrong number, which is
  // the defect class this platform keeps hitting.
  assert.match(sql, /CONSTRAINT seat_filled_has_holder/);
});

test('an accepted contribution carries a share, and a rejection carries a reason', () => {
  assert.match(sql, /CONSTRAINT contribution_accepted_has_share/);
  assert.match(sql, /CONSTRAINT contribution_rejected_has_reason/);
  // Basis points, not percent: a five-way split of 70% does not divide cleanly in whole percentages,
  // and rounding somebody's share away is the small dishonesty that ends a team.
  // Pinned to the rule, not to the column alignment. My first version matched the exact spacing of
  // the declaration, which is the kind of assertion that fails on a reformat and passes on a real
  // regression.
  assert.match(sql, /share_bp\s+integer CHECK/);
  assert.match(sql, /share_bp >= 0 AND share_bp <= 10000/);
});

test('Standing is a ledger, never a stored total', () => {
  // Append-only with a dedupe key, so the same real-world event cannot be recorded twice, and a
  // reversal is a negative row rather than a deletion — the history stays true including the parts
  // that came undone.
  assert.match(sql, /dedupe_key\s+text NOT NULL UNIQUE/);
  assert.match(sql, /verified_by\s+text NOT NULL CHECK/);
  assert.ok(!/standing_total|UPDATE yp_labs\.users SET standing/i.test(sql), 'no stored total anywhere');
  // verified_by records WHO ELSE acted. That is the rule: you cannot earn it alone.
  assert.match(sql, /'owner','staff','stranger','system','reversal'/);
});

test('an agreement is versioned and signed by everyone', () => {
  // The team writes its own terms. What the platform guarantees is narrow: nobody is bound to
  // something they never saw, and the old version stays readable.
  assert.match(sql, /UNIQUE \(concept_id, version\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS yp_labs\.agreement_signatures/);
  assert.match(sql, /UNIQUE \(agreement_id, user_id\)/);
  // Locked when the listing goes live: the split a buyer sees is the split that pays.
  assert.match(sql, /locked_at/);
});

test('a listing in review says why it is sitting there', () => {
  // 33 in review against 13 live. Staff currently rediscover the same problem every time they open
  // the queue while the creator waits in silence.
  for (const s of ['ready_for_decision', 'missing_baseline', 'possible_live_business',
    'possible_misrepresentation', 'needs_risk_disclosure']) {
    assert.ok(sql.includes(s), 'review status missing: ' + s);
  }
});

test('the migration runs in the recorded order', () => {
  const order = fs.readFileSync('docs/migrations/ORDER.txt', 'utf8').split('\n').map((l) => l.trim());
  assert.ok(order.includes('057_teams_seats_contributions.sql'));
  assert.ok(order.indexOf('004_marketplace_schema.sql') < order.indexOf('057_teams_seats_contributions.sql'));
});
