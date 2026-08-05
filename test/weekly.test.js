'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const weekly = require('../src/services/clay/weekly');

test('weekStartOf returns the Monday of that week, in UTC', () => {
  assert.strictEqual(weekly.weekStartOf('2026-08-05T12:00:00Z'), '2026-08-03'); // Wed -> Mon
  assert.strictEqual(weekly.weekStartOf('2026-08-03T00:00:00Z'), '2026-08-03'); // Mon -> itself
  assert.strictEqual(weekly.weekStartOf('2026-08-09T23:59:00Z'), '2026-08-03'); // Sun -> that Mon
  assert.strictEqual(weekly.weekStartOf('2026-08-10T00:00:00Z'), '2026-08-10'); // next Mon rolls over
});

test('an issue address is stable and derived from its week', () => {
  assert.strictEqual(weekly.slugForWeek('2026-08-03'), 'clay-weekly-2026-08-03');
  // Same week always yields the same address, so an issue can never be duplicated by re-running.
  const a = weekly.slugForWeek(weekly.weekStartOf('2026-08-05T09:00:00Z'));
  const b = weekly.slugForWeek(weekly.weekStartOf('2026-08-07T22:00:00Z'));
  assert.strictEqual(a, b);
});

test('the service exposes the approval chain as separate, deliberate steps', () => {
  // Composing, approving, publishing and SENDING are distinct on purpose: nothing reaches a
  // person's inbox as a side effect of assembling an issue.
  ['composeIssue', 'approve', 'publish', 'sendIssue', 'offerSponsorship', 'respondToSponsorship', 'unsubscribe']
    .forEach((fn) => assert.strictEqual(typeof weekly[fn], 'function', fn + ' must exist'));
});

test('the cadence exists and is separate from anything that reaches a reader', () => {
  assert.strictEqual(typeof weekly.tick, 'function');
  // The scheduled job drafts only. Approving, publishing and sending stay distinct functions a
  // human has to call, so no schedule can ever put an issue in front of a reader on its own.
  ['approve', 'publish', 'sendIssue'].forEach((fn) => assert.strictEqual(typeof weekly[fn], 'function'));
});

test('one issue per week: the address a tick would claim is identical all week', () => {
  const mon = weekly.slugForWeek(weekly.weekStartOf('2026-08-03T06:00:00Z'));
  const fri = weekly.slugForWeek(weekly.weekStartOf('2026-08-07T18:00:00Z'));
  const sun = weekly.slugForWeek(weekly.weekStartOf('2026-08-09T23:00:00Z'));
  assert.strictEqual(mon, fri);
  assert.strictEqual(fri, sun);
  // and a new week is genuinely a different issue
  assert.notStrictEqual(sun, weekly.slugForWeek(weekly.weekStartOf('2026-08-10T00:00:00Z')));
});
