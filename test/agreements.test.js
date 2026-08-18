'use strict';
// AGREEMENTS — the split a team writes for itself.
//
// Earlier drafts had the platform computing contribution weights from asset kinds. That was wrong. A
// team knows what the demo was worth against the marketing better than any table does, and deciding
// it for them is stepping in the way of a real business being built.
//
// What the platform guarantees is narrow and absolute, and everything else is theirs.
//
// Driven against a real Postgres and a running server before shipping.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const src = fs.readFileSync('src/routes/agreements.js', 'utf8');

test('the team writes the terms; the platform only checks them', () => {
  assert.match(src, /The platform does not decide what people's work is worth to each other/);
  assert.match(src, /SUGGESTED, NEVER IMPOSED/);
  // A suggestion exists and is never applied by itself.
  assert.match(src, /function suggest\(team\)/);
  assert.ok(!/INSERT INTO team_agreements[\s\S]{0,200}suggest\(/.test(src),
    'the suggestion must never be written as an agreement on its own');
});

test('the shares add to exactly the seller side', () => {
  assert.match(src, /if \(total !== 10000\)/);
  // And it says what they DID add to, so the person can fix it rather than guess.
  assert.match(src, /The shares add up to ' \+ \(total \/ 100\) \+ '%/);
});

test('nobody with a stake can be left out, and no outsider written in', () => {
  // Silence is how somebody ends up with nothing. Everybody is named, even at zero.
  assert.match(src, /has to be named, even at zero, so nobody is left out silently/);
  assert.match(src, /That agreement names somebody who is not on this project/);
  assert.match(src, /Somebody appears twice in that agreement/);
});

test('a token share is refused, and that is the abuse this guards against', () => {
  // A 0.5% share is a way of getting somebody's work for nothing while the paperwork looks fair.
  // It is the single most likely way this mechanic gets abused.
  assert.match(src, /const FLOOR_BP = 100;/);
  assert.match(src, /is not really a share — if they are on this project, give /);
});

test('everybody signs, and the proposer signs by proposing', () => {
  assert.match(src, /INSERT INTO agreement_signatures \(agreement_id, user_id\) VALUES \(\$1,\$2\)/);
  assert.match(src, /Proposed, and you have signed it/);
  assert.match(src, /Only somebody on this project can sign its terms/);
  // It becomes the team's terms only when the last person signs.
  assert.match(src, /if \(!missing\.length\) \{\s*\n\s*await query\(`UPDATE team_agreements SET state='signed'/);
});

test('who it is waiting on is named, not counted', () => {
  // "Waiting on 2 people" is a fact nobody can act on. "Waiting on Rel and Tonya" is one somebody
  // can go and chase.
  assert.match(src, /Named, not counted/);
  assert.match(src, /waiting_on: cur\.rows\.length && cur\.rows\[0\]\.state === 'proposed'/);
  assert.match(src, /missing\.map\(\(m\) => m\.name\)\.join\(' and '\)/);
});

test('a live listing locks the split', () => {
  // Verified live: a project with a live listing refuses a rewrite. The split a buyer sees is the
  // split that pays, and nothing changes mid-sale.
  assert.match(src, /async function isLocked/);
  assert.match(src, /status IN \('live','sold'\)/);
  assert.match(src, /its split is locked. The split '\s*\n?\s*\+ 'a buyer sees is the split that pays/);
});

test('a new version supersedes and the old one stays readable', () => {
  // You can always see what was agreed and when. An agreement that can be silently edited is not an
  // agreement.
  assert.match(src, /UPDATE team_agreements SET state='superseded'/);
  assert.match(src, /Any '\s*\n?\s*\+ 'earlier version stays readable/);
  assert.match(src, /That version has been replaced by a newer one/);
});

test('a settled agreement cannot be pulled back', () => {
  // Withdrawing something everybody signed would be changing terms under people.
  assert.match(src, /Only the person who proposed this can pull it back/);
  assert.match(src, /That is already settled\. Propose a new version instead/);
});

test('it is mounted', () => {
  assert.match(fs.readFileSync('src/server.js', 'utf8'),
    /app\.use\('\/api\/agreements',\s+require\('\.\/routes\/agreements'\)\)/);
});
