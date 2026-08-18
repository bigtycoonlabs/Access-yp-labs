'use strict';
// SEATS — what a project is asking for.
//
// Zero partner requests have ever been sent on this platform. Launch Partners has been built, live
// and unused since it shipped, and the reason is not that people do not want to collaborate: a
// project could say it was open to partners and never say what it NEEDED. Somebody browsing saw
// "open to launch partners" and had no idea whether that meant code, customers or cash.
//
// Every rule below was driven against a real Postgres and a running server before shipping, for the
// case it must refuse and the case it must allow.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const src = fs.readFileSync('src/routes/seats.js', 'utf8');
const migration = fs.readFileSync('docs/migrations/057_teams_seats_contributions.sql', 'utf8');

test('a seat must say what it actually needs', () => {
  // The whole reason the old board went unused. Twenty characters is not a quality bar, it is a
  // floor below which the seat is not describing anything.
  assert.match(src, /isLength\(\{ min: 20, max: 600 \}\)/);
  assert.match(src, /"Open to partners" is what nobody could act on/);
});

test('the five kinds are the ones a project actually needs filling', () => {
  for (const k of ['build', 'sell', 'materials', 'operate', 'craft']) {
    assert.ok(src.includes(k + ':'), 'missing kind: ' + k);
    assert.ok(migration.includes("'" + k + "'"), k + ' must be in the database constraint too');
  }
});

test('nobody can hold a seat on their own project', () => {
  // Their project already IS the seller side. A seat would be a share of their own money.
  assert.match(src, /This is your own project, so there is no seat for you to hold on it/);
  assert.match(src, /The project owner cannot hold a seat on their own project/);
});

test('only the owner changes who is on their project', () => {
  assert.match(src, /async function ownedByMe/);
  assert.match(src, /That is not your project, so you cannot change who is on it/);
});

test('the five-seat limit is stated before somebody acts, not after', () => {
  // The platform's own rule, learned three times this month: never offer something the server will
  // refuse. seatsTaken mirrors the database trigger exactly so the screen can say "full" first.
  assert.match(src, /async function seatsTaken/);
  assert.match(src, /if \(taken >= 5\) throw new ApiError\(409, FULL\)/);
  assert.match(src, /remaining: Math\.max\(0, 5 - taken\), full: taken >= 5/);
  // And the trigger is still the guarantee underneath, turned into a sentence rather than a
  // constraint violation reaching a person.
  assert.match(src, /function rethrow/);
  assert.match(src, /five people on it/);
});

test('an OPEN seat does not count against the five', () => {
  // Only people count. Blocking a fifth open seat would stop an owner describing what they need.
  assert.match(src, /An OPEN seat is not a person, so it does not count against the five/);
});

test('a seat is released by its holder, never taken by the owner', () => {
  assert.match(src, /That is not your seat\./);
  assert.match(src, /it cannot be taken from them here/);
});

test('releasing a seat and releasing a share are separate decisions', () => {
  // Leaving quietly and finding out later that your share went with you is the kind of surprise
  // that ends a collaboration badly. What was already accepted stays in the project either way.
  assert.match(src, /body\('share'\)\.isIn\(\['keep', 'release'\]\)/);
  assert.match(src, /What you already built stays in the project, and so does your share of it/);
  assert.match(src, /Releasing the SEAT and releasing the SHARE are separate acts/);
});

test('a trade needs three people to agree, and moves no share by itself', () => {
  // A team is people who chose each other. A seat transferable without the owner's consent is a way
  // for a stranger to end up inside somebody's business.
  assert.match(src, /That is not your seat to trade/);
  assert.match(src, /They already hold a seat on this project/);
  assert.match(src, /Their share is whatever the team\\u2019s next agreement says/);
  // The share can only change where every member signs. Not here.
  assert.match(src, /It does not move the share/);
});

test('the platform records the connection and stays out of the money', () => {
  assert.match(src, /arranges no equity, takes no fee on a connection, and is not party to/);
  // Nothing in this file touches a payment, a fee or a split.
  assert.ok(!/stripe|price_cents|payout|charge/i.test(src.replace(/^\s*\/\/.*$/gm, '')));
});

test('the open board exists, because it is what creators work', () => {
  // The counterpart to the staff review queue. Every unfilled seat across every project, in one
  // place, filterable by what somebody can actually do.
  assert.match(src, /router\.get\('\/open'/);
  assert.match(src, /WHERE s\.status='open'/);
  const server = fs.readFileSync('src/server.js', 'utf8');
  assert.match(server, /app\.use\('\/api\/seats',\s+require\('\.\/routes\/seats'\)\)/);
});
