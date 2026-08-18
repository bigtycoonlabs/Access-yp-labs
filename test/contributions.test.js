'use strict';
// CONTRIBUTIONS — somebody else's work, merged into a project.
//
// THE PROJECT OWNER DECIDES. Not staff, not Clay. It is their project and nobody else can judge
// whether a contribution fits what they are building.
//
// Every rule below was driven against a real Postgres and a running server before shipping.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const src = fs.readFileSync('src/routes/contributions.js', 'utf8');

test('the owner decides, and nobody else', () => {
  assert.match(src, /Only the person whose project this is can accept work into it/);
  assert.match(src, /Only the person whose project this is can decide work offered to it/);
  // Staff and Clay are absent from this file entirely. That is the point.
  assert.ok(!/staffOnly|authorize\('staff'/.test(src));
});

test('you cannot contribute to your own project', () => {
  // The seller side is already theirs. A contribution would be a share of their own money.
  assert.match(src, /Anything you add to it is yours already/);
});

test('a share is fixed at acceptance and never recalculated', () => {
  // A contributor knows what they earned the day they earned it, rather than discovering months
  // later that it was diluted by everyone who came after. That dilution is what turned Quirky's
  // community from proud to resentful: 1,005 contributors averaged about $992 each on their
  // biggest product ever.
  // Pinned to the sentence a contributor is actually told. My first version used an alternation
  // whose left branch would have matched almost anything, which is a test that passes on the wrong
  // thing.
  assert.match(src, /is fixed now and will not change if other people join later/);
  assert.match(src, /The share is fixed at acceptance and never recalculated/);
  assert.ok(!/UPDATE contributions SET share_bp=\$\d+\s*\n?\s*WHERE concept_id/.test(src),
    'no route may recalculate an existing share');
});

test('the shares can never exceed the seller side', () => {
  // Checked at acceptance, not at payout. Discovering at the point of sale that a team promised
  // 130% is the worst possible moment to find out.
  assert.match(src, /if \(total > 10000\)/);
  assert.match(src, /That would promise more than the whole seller side/);
  // And it says how much is actually left, so the owner can act rather than guess.
  assert.match(src, /is already committed to other people, so there is/);
});

test('a rejection carries a reason and costs nothing', () => {
  // This platform needs people trying far more than it needs people cautious.
  assert.match(src, /isLength\(\{ min: 15, max: 800 \}\)/);
  assert.match(src, /the difference between a no and a door closing/);
  assert.match(src, /It costs them nothing — no mark, no '\s*\n?\s*\+ 'penalty/);
});

test('superseded work keeps its share', () => {
  // Taking it back later would make every acceptance provisional, and a provisional share is not
  // worth contributing for.
  assert.match(src, /Their share stays — it was in the project when you accepted it/);
  assert.match(src, /a provisional share is not worth contributing for/);
});

test('a full project says so before somebody does the work', () => {
  // The rule this platform keeps relearning: never let somebody act into a refusal. Told before
  // they spend an evening on it, not after they submit.
  assert.match(src, /async function seatsTaken/);
  assert.match(src, /if \(await seatsTaken\(req\.params\.conceptId\) >= 5\) throw new ApiError\(409, FULL\)/);
  // Somebody already on the team is not a sixth person.
  assert.match(src, /async function alreadyOnTeam/);
});

test('one offer at a time, per person per project', () => {
  assert.match(src, /You already have something waiting on this project/);
});

test('a portfolio is counted, never valued', () => {
  // A share of something unsold is not money. Putting a number on it would be the platform
  // forecasting a sale that has not happened — the exact failure the value ladder was fixed for.
  assert.match(src, /Deliberately no estimated value/);
  assert.match(src, /You do not hold a position in anything yet/);
  const mine = src.slice(src.indexOf("router.get('/mine'"));
  assert.ok(!/estimated|worth|expected|projected/i.test(mine.replace(/^\s*\/\/.*$/gm, '')));
});

test('nothing here moves money', () => {
  // A share is recorded. It is paid out of a completed sale, after the webhook confirms it, and it
  // reverses if the sale reverses. None of that happens in this file.
  const code = src.replace(/^\s*\/\/.*$/gm, ' ');
  assert.ok(!/stripe|charge|payout|transfer/i.test(code));
});

test('it is mounted', () => {
  assert.match(fs.readFileSync('src/server.js', 'utf8'),
    /app\.use\('\/api\/contributions', require\('\.\/routes\/contributions'\)\)/);
});
