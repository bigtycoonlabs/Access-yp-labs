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
const migration = fs.readFileSync('docs/migrations/057_teams_seats_contributions.sql', 'utf8');

test('the five kinds are the ones a project actually needs filling', () => {
  // The route half of this check read routes/seats.js, retired with the marketplace. The table and
  // its constraint are still used by the live team, contribution and agreement routes.
  for (const k of ['build', 'sell', 'materials', 'operate', 'craft']) {
    assert.ok(migration.includes("'" + k + "'"), k + ' must be in the database constraint');
  }
});
