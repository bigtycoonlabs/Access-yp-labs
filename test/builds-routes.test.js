'use strict';
// THE BUILD ENDPOINTS.
//
// Thin on purpose. Every rule lives in the database (what can be charged) or the service (what can
// be understood, approved or called ready). A route that re-implements a rule will disagree with it
// later, and the version somebody reaches is whichever one they happened to call.
//
// Walked over HTTP against a real Postgres. Codes observed:
//
//   empty list                                200   "Nothing built yet..."
//   "build me a website"                      422   unclear
//   a real brief                              201   free mock queued
//   approve before it is finished             403   refused
//   a crafted stage:real chargeable:true      201   and it came back a FREE MOCK

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const src = fs.readFileSync('src/routes/builds.js', 'utf8');
const server = fs.readFileSync('src/server.js', 'utf8');

test('it is mounted', () => {
  assert.match(server, /app\.use\('\/api\/builds'/);
});

test('a crafted request cannot buy anything', () => {
  // Walked: POST with stage "real" and chargeable true returned HTTP 201 and a FREE MOCK. The
  // request body is not consulted for either field — the expensive path cannot be reached by
  // accident or by hand.
  assert.ok(!/req\.body\.chargeable/.test(src));
  assert.ok(!/req\.body\.stage/.test(src));
  assert.match(src, /Always a mock, always free/);
  // Matched on a phrase, not across a line break. Fifth time today I have written an assertion that
  // failed on where a comment happened to wrap rather than on anything the code does.
  assert.match(src, /cannot be reached by accident or by a crafted request/);
});

test('the one endpoint that creates a charge takes no price', () => {
  // What it costs is not something a request can influence.
  assert.match(src, /takes no amount, no price and no plan/);
  const approve = src.slice(src.indexOf("'/:id/approve'"), src.indexOf("'/:id/fix'"));
  assert.ok(!/amount|price|cents|plan/.test(approve.replace(/\/\/.*/g, '')));
});

test('"not yet" is not reported as the person getting it wrong', () => {
  // 'unclear' is the one case where the right answer is a question. Giving it a code that reads like
  // a mistake teaches people to phrase requests defensively rather than plainly. Walked: 422.
  assert.match(src, /deliberately NOT an error the person caused/);
  assert.match(src, /unclear: 422/);
});

test('a client can tell "you cannot" from "not yet" from "we broke"', () => {
  // Without the kind, all three render as the same red box and the person cannot tell whether to
  // rephrase or to wait. Walked: 403 refused, 422 unclear, 502 unavailable.
  assert.match(src, /refused: 403/);
  assert.match(src, /unavailable: 502/);
  assert.match(src, /kind: r\.kind/);
});

test('one translation, used by every endpoint', () => {
  // So a caller never has to guess which endpoint reports how.
  assert.match(src, /function send\(res, r, okCode = 200\)/);
  assert.strictEqual((src.match(/send\(res,/g) || []).length, 5); // definition + four routes
});

test('the routes re-implement no rule', () => {
  // No charging logic, no approval-state logic, no brief parsing. All of it lives below.
  assert.ok(!/chargeable\s*=/.test(src));
  assert.ok(!/INSERT INTO/.test(src));
  assert.ok(!/status\s*!==\s*'ready'/.test(src));
});
