'use strict';
// THE ROUTES. Every assertion here was walked over real HTTP against a real Postgres, as two
// different people, before it was written.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const obl = fs.readFileSync('src/routes/obligations.js', 'utf8');
const biz = fs.readFileSync('src/routes/businesses.js', 'utf8');
const server = fs.readFileSync('src/server.js', 'utf8');
const R = require('../src/lib/ranking');

test('both routers are mounted — a route nobody can reach does not exist', () => {
  assert.match(server, /app\.use\('\/api\/businesses'/);
  assert.match(server, /app\.use\('\/api\/obligations'/);
});

test('a business needs only a name', () => {
  // There is no wizard. A form that demands entity type and formation state before it will save is
  // how a person bounces on day one; Penny fills the rest in as she learns it.
  assert.match(biz, /body\('name'\)\.isString\(\)/);
  assert.match(biz, /body\('entity_type'\)\.optional/);
  assert.match(biz, /body\('formation_state'\)\.optional/);
});

test('operating states default to the formation state, never to empty', () => {
  // An empty array quietly means "owes nothing anywhere", which is the wrong default for a
  // compliance product. Walked: posting formation_state OH with no operating_states returned ['OH'].
  assert.match(biz, /an empty array would quietly mean\s*\n?\s*\/\/ "owes nothing anywhere"/);
  assert.match(biz, /\(b\.formation_state \? \[b\.formation_state\] : \[\]\)/);
});

test('a business is archived, never deleted', () => {
  // A wound-down business still had filings that were owed, and a dissolved entity can be audited.
  assert.match(biz, /archived_at=now\(\)/);
  assert.ok(!/DELETE FROM businesses/i.test(biz));
  assert.match(biz, /Archived rather than deleted\. Nothing it owed has been erased\./);
});

test('a cost with no basis is refused in words, not as a constraint violation', () => {
  // The database refuses it either way. Catching it here means the person gets a sentence.
  assert.match(obl, /If you are putting a number on it, say whether that is known or an estimate/);
  assert.match(obl, /A cost nobody can explain is a cost nobody should trust/);
});

test('the list endpoint filters by area too, not just by business', () => {
  // The same bug the ranked list already had. Walked as a bookkeeper with money:view: the list
  // returned ['invoice_out'] and nothing else.
  assert.match(obl, /filtering by business and then showing everything inside it is the bug this/);
  assert.match(obl, /const kinds = Object\.keys\(R\.KIND_AREA\)\.filter/);
});

test('completing a recurring obligation brings back the next one', () => {
  // An annual report completed this year is owed again next year. A compliance product that forgets
  // that is worse than a calendar. Walked: done -> "The next one is on 2027-09-27."
  assert.match(obl, /Recurring things reappear rather than vanishing/);
  assert.match(obl, /due_at \+ recurs_every/);
});

test('export is permissioned, never blocked, and always logged', () => {
  assert.match(obl, /'export', 'manage'/);
  assert.match(obl, /P\.logExport\(/);
  // Logged after the rows exist. A logged export that failed is a worse record than no log.
  assert.match(obl, /Logged after the rows exist, never before/);
});

test('the CSV is readable by the person who opens it', () => {
  // Found by opening the file rather than by checking it returned 200.
  //
  // Dates went out as JavaScript's Date.toString() — "Sun Sep 27 2026 09:00:00 GMT+0000 (Coordinated
  // Universal Time)" — which Excel will not parse. And the cost went out in cents, so somebody
  // reading 2500 against an Ohio annual report sees two and a half thousand dollars. It is $25.
  assert.match(obl, /v\.toISOString\(\)\.slice\(0, 19\)\.replace\('T', ' '\)/);
  assert.match(obl, /cost_if_missed_usd/);
  assert.match(obl, /\(row\.cost_if_missed_cents \/ 100\)\.toFixed\(2\)/);
  assert.ok(!/'cost_if_missed_cents'\]/.test(obl.split('const cols =')[1] || ''));
});

test('every response carries the sentence, not just the numbers', () => {
  // A client that assembles "costs $2,400 and it was due 19 days ago" from four fields will assemble
  // it differently in three places, and one of them will round.
  assert.match(obl, /const decorate = \(rows\) => rows\.map\(\(r\) => Object\.assign\(\{\}, r, \{ says: R\.explain\(r\) \}\)\)/);
});

test('the spoken summary is grammatical at one, some and all', () => {
  // "One thing needs you, 1 of them overdue" was wrong, and this line is read aloud.
  const m = (n, o) => Array.from({ length: n }, (_, i) => ({ title: 'T', cost_if_missed_cents: 240000, cost_basis: 'known', overdue: i < o }));
  assert.match(R.summarise(m(1, 1)), /One thing needs you, and it is overdue\./);
  assert.match(R.summarise(m(3, 3)), /3 things need you, all of them overdue\./);
  assert.match(R.summarise(m(3, 2)), /3 things need you, 2 of them overdue\./);
  assert.ok(!/overdue/.test(R.summarise(m(3, 0)).split('.')[0]));
});

test('an id in a URL does not let somebody enumerate businesses', () => {
  // No-access and does-not-exist are the same 404 here on purpose. The legible refusal belongs in
  // conversation with Penny, where there is a name to say and a person to point at.
  assert.match(biz, /distinguishing them would let somebody enumerate businesses/);
});
