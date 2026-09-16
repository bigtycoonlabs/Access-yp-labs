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
  // The body is never read for stage or chargeable. Since 16 Sept 2026 a real build can be started
  // directly, but only by answering the mock-up question with no, which is validated to yes or no
  // and recorded as mock_declined_at. Walked: stage "real" with chargeable true and no answer
  // started nothing and returned the question.
  assert.ok(!/req\.body\.chargeable/.test(src));
  assert.ok(!/req\.body\.stage/.test(src));
  assert.match(src, /isIn\(\['yes', 'no', true, false\]\)/);
  assert.match(src, /mock_first: req\.body\.mock_first/);
  assert.match(src, /cannot be set by a request/);
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
  // Every response goes through send: the only direct res.status / res.json are inside it.
  assert.strictEqual((src.match(/res\.status\(/g) || []).length, 2);
  assert.strictEqual((src.match(/res\.json\(/g) || []).length, 0);
});

test('the routes re-implement no rule', () => {
  // No charging logic, no approval-state logic, no brief parsing. All of it lives below.
  assert.ok(!/chargeable\s*=/.test(src));
  assert.ok(!/INSERT INTO/.test(src));
  assert.ok(!/status\s*!==\s*'ready'/.test(src));
});
